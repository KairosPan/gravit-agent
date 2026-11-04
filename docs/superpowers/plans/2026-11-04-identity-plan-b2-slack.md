# Identity, plan B2 — Slack through the account, over Socket Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The account holds Gravit's second network, Slack. It keeps the app's two tokens, the operator's bound handle and an outbound Socket Mode socket, and talks with the operator in the app's direct message only. The Identity tab connects Slack with Install app… (four sheets, one signature), and the desk talks to whichever network a text came from, with nothing new in the face but the network's name.

**Architecture:**
- **B1's identity module grows a second network, not a copy of the first.** Task 1 lifts the four places where B1 is Telegram-shaped into seams, and Telegram's tests stay green unchanged: the pending connection's listener (`PendingSource`), the sender (`Transport`, replacing `identity.ts` `Link`), the connected poller (`Connector`, which `TelegramConnector` already nearly is), and the token file (`NetworkSecret` becomes a union). B2 then adds `slack-api.ts` (the Web API over `fetch`), `slack-socket.ts` (one Socket Mode link over Node 22's global `WebSocket`) and `slack.ts` (the pending source, the connector and the transport).
- **The tokens' one trip is B1's.** At sheet 1's Next the page sends `{appToken, botToken, keyHash, salt}` once to `POST /api/account/identity/slack/token` (its own reader, skipped by the JSON parser). `keyHash` is B1's recipe over one string, `appToken ‖ NUL ‖ botToken`. `connectNetwork` signs only that fingerprint, as for Telegram.
- **Nothing listens.** The account calls `apps.connections.open` with the app-level token, opens the `wss://` URL it answers, acks every envelope by its `envelope_id`, and reconnects on a `disconnect` envelope or a close. On every `hello` it also backfills the DM from its cursor with `conversations.history`, so a text written while no socket was open still arrives, once.
- **The face changes in three places only.** One proxied write route (the Slack token route), the wire id rule (Slack's ids carry a dot), and the desk's reply network: B1 hard-codes `telegram` for every phone turn's answer. The client's Slack row gets Install app… in place of B1b's disabled `Soon` chip.

**Tech Stack:** Node 22 and TypeScript; express 4 and vitest in `account/`; `node --test` via tsx in `face/`. The Slack Web API (`auth.test`, `bots.info`, `users.info`, `apps.connections.open`, `conversations.history`, `chat.postMessage`) goes over `fetch`, and Socket Mode over the global `WebSocket` (undici, typed by `@types/node` 22.20). There is **no new dependency**. The tests use a fake Slack on loopback: a `node:http` Web API and a hand-rolled RFC 6455 socket on the same port.

**Spec:** `docs/superpowers/specs/2026-11-03-account-split-and-identity-design.md`. In scope: Part B §5.7 (Slack), with what §5.1–§5.6, §5.9 and §5.10 say about every network, §7 items 6–10 and 14, §8 ("the Slack manifest's scopes", "how each network formats messages") and §9 "B2". Read first: plans B1a (`docs/superpowers/plans/2026-11-04-identity-plan-b1a-telegram-account-and-face.md`) and B1b (`…-b1b-identity-tab.md`). Their Global Constraints, names and rulings hold here unless this plan says otherwise. Then read `DEVELOPMENT.md` §3.9 "Identity", `face/README.md` "The phone drill", and `account/src/portfolio/identity/*.ts` as built. Out of scope: iMessage, Slack channels, groups or threads, slash commands, Block Kit buttons, approving cards from Slack, and Enterprise Grid.

## Global Constraints

- **Where to work.**
  - Work on `feat/identity-b2`, cut from local `main` at the commit that adds this plan, in the worktree `.claude/worktrees/identity-b2`. Never push.
  - Never run `npm run service`, `npm run account:service`, `npm run market:service`, `docker compose`, or a server outside a test.
  - Never touch `~/.dsh`, `~/.buyer-agent-demo/`, a real Slack workspace or a real Slack app. Every Web API call and every socket in a test goes to Task 2's `fakeSlack`.
  - Never open `.env*`, `~/.dsh/.credentials.yaml` or a key file.
  - `FACE_SMOKE=1` runs from the worktree, which is outside `/tmp` and `$TMPDIR`.
- **No token anywhere.**
  - Never paste a real token into a file, a test, a commit or a message.
  - The tests' made-up Slack tokens are built by concatenation at runtime (`["xo", "xb-", …].join("")`), so no literal in the tree matches a secret scanner's Slack pattern. A literal `xoxb-…`, `xapp-…`, `xoxp-…` or `xoxe-…` of scanner shape in any committed file is a finding.
  - Task 3 adds a test that walks `account/` and `face/` for such literals.
- **Commits.**
  - Write each message to a file in the session scratchpad and commit with `git commit -F <that file's literal absolute path>`.
  - No backticks, no `$()`, no shell variables, no attribution lines.
  - English for code, docs and commits.
  - Each task's last step gives the message.
- **Suites, green after every task, and `main` working after every task.**
  - `cd account && npm test && npm run typecheck` (vitest).
  - `cd face && npm test && npm run typecheck`. Tasks 6 and 7 also run `cd face && FACE_SMOKE=1 npm test`.
  - `cd market && npm test` once, at the end. Nothing here touches it.
  - Record each suite's count at the start of Task 1, in the task's notes.
  - Known flakes: rerun them alone before calling one red.
    - account: `ui-standin`'s real-clock test, market-link's "sources fill in", and identity-send's "outbox flushed".
    - face: `lunhui-market`, `annotator`, `order-gate-midboot-smoke`, and producer's "aborted run".
- **Names fixed by this plan.**
  - Networks: `type Network = "slack" | "telegram"`; `NETWORKS = ["telegram", "slack"]`. In the signed routing string, networks are sorted, so a row with both reads `chat=slack,telegram`.
  - A Slack message id on the wire is `slack:<ts>`, for example `slack:1730812345.001200`. There is no channel in it: Gravit has exactly one DM on Slack, and the inbox's `bot` field already keeps two bindings apart.
  - The one wire id rule, used by the account's `REPLY_TO` and `sendOf` and by the face's `WIRE_ID`: `^(?:telegram:\d{1,16}|slack:\d{9,12}\.\d{6})$`. It is exported from `kinds.ts` as `WIRE_ID`.
  - Slack ids carry their team. In the signed `connectNetwork`:
    - `botId` = `<team id>:<bot user id>` (`T0FAKE001:U0BOT0001`);
    - `operatorId` = `<team id>:<user id>`;
    - `speaksAs` = `@<bot user name>`;
    - `talksOnlyWith` = `@<display name, else name>`.
    - The owner type's fields do not change.
  - A Slack stranger is `senderRef("slack", "<team>:<user>")`, masked `…` plus the user id's last three characters (`…7QK`). The block rule's `MASKED` becomes `/^…[0-9A-Z]{1,3}$/`.
  - The fingerprint is `keyHash = hex sha256(salt ‖ appToken ‖ 0x00 ‖ botToken)`, which is `keyMatches(salt, appToken + "\u0000" + botToken, keyHash)`. Neither token can hold a NUL byte, so the join is unambiguous, and B1's `brain-keys.ts` and the client's `fingerprintOf` serve unchanged.
  - Token shapes:
    - app-level: `^xapp-[0-9]-[A-Z0-9]{8,14}-[0-9]{6,16}-[a-f0-9]{32,80}$`;
    - bot: `^xoxb-[0-9]{6,16}-[0-9]{6,16}-[A-Za-z0-9]{20,40}$`.
    - Redacted anywhere, in text sent and in every log line: `/\bx(?:ox[abposre]|app)-[A-Za-z0-9-]{10,}/g` → `<token>`. This is on top of B1's exact-spelling redactor.
  - The account's home files:
    - the tokens: `<home>/credentials/networks/slack.json` = `{"appToken","botToken","appId","channel","botId","username","operatorId","operatorHandle"}`, under B1's secret-file rules;
    - the cursor: `<home>/identity/slack.cursor`, the last stored `ts`, the analogue of `telegram.offset`.
  - The Web API base is `https://slack.com/api`. `ACCOUNT_SLACK_API` overrides it only with `http://127.0.0.1:<port>`, as `ACCOUNT_TELEGRAM_API` does.
  - The socket URL that `apps.connections.open` answers is taken only as `wss://<name>.slack.com/…`, or, under the loopback override, `ws://127.0.0.1:<that same port>/…`. Anything else is refused with one line, so no answer can steer the app token's socket to another host.
- **Size budgets.** `GRAVIT.md` stays at or under 4,500 bytes and is not edited. `dsh/profile/desk.md` stays at or under 3,000 bytes; it is at 2,585, and Task 6 adds one line.
- **Product copy** is English and plain. Nothing sent links to the face (B1's `withoutLocalLinks` and the notices' defang hold on Slack too).
- **Rulings already made, not to be reopened:**
  - Socket Mode only.
  - Two tokens, both kept only in the account.
  - The DM only: never a channel, group or mpim, and never a bot or an edit.
  - A stranger in the DM is counted, never stored and never answered.
  - Outbound goes through `chat.postMessage`, with `&`, `<` and `>` escaped and every Slack token shape redacted.
  - Message ids carry the `slack:` prefix.
  - The commands reach the desk from Slack even with Chat off (D19).
  - Routing, quiet hours, the outbox, the 12 h age limit and the notices are B1's.
  - The account picks the recipients.
  - There is no new runtime dependency.
- **This plan's rulings** (each says why where it is used):
  1. **Ack after the inbox append.**
     - The connector acks an operator's text only after `InboxRing.append` returns. A text the inbox cannot store is not acked, so Slack sends it again with `retry_attempt` > 0.
     - Every other envelope is acked at once: strangers, channels, bots, edits, `hello`, `disconnect` and slash or interactive envelopes.
     - The inbox's `messageId`+`bot` dedupe makes a retry harmless.
     - Why: this is the analogue of B1's "append before the offset moves" (spec §5.5).
  2. **The backfill.**
     - On each `hello`, before it handles any live envelope, the connector reads `conversations.history(channel, oldest = cursor, inclusive = false, limit = 100)`. It reads page by page, at most `INBOX_MAX` messages, oldest first, and appends what the filter admits. The cursor advances only after each append.
     - Live envelopes that arrive meanwhile wait in memory, unacked, and are handled after the backfill.
     - Why: Slack retries an unacked envelope only a few times over minutes, and an envelope sent while no socket is open is not held as Telegram holds updates. Without the backfill, an account that is down past Slack's retries loses the operator's texts, and §5.5 says none is lost. `im:history` already covers the read.
  3. **No threads.** Gravit answers top level in the DM, never with `thread_ts`. An operator's text in a thread carries `replyTo: slack:<thread_ts>`, so `watch.contextFor` maps a threaded reply to an alert. Why: a DM is one conversation. A thread reply would hide the answer from the DM's main view. And the account cannot know whether a `replyTo` it is given was itself threaded without keeping a map it has no other use for.
  4. **Plain text.** `chat.postMessage` is called with `mrkdwn: false`, `unfurl_links: false` and `unfurl_media: false`, and the text is escaped (`&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`). A text is split by B1's `splitMessage` at 4,000 code units before escaping, which stays well under Slack's 40,000. Why: B1's Telegram is plain text with no parse mode, and escaping keeps a text from carrying `<!channel>` or `<https://x|y>`.
  5. **The `!` prefix.** Slack's composer takes a leading `/` as one of its own slash commands, and `/status` and `/mute` are Slack built-ins. On Slack the operator types `!status`, `!pause 30m`, `!mute 30m`, `!new` and `!stop`. The Slack connector rewrites a leading `!` before one of the five words to `/` before it stores the text, so the face's `parseCommand` and B1's Chat-off pass-through (`PHONE_COMMAND`) serve unchanged. A `/status` that still arrives as text (typed after a space, say) is taken as it is.
  6. **Scopes.** The bot scopes are `chat:write`, `im:history` and `users:read`. The event is `message.im`. The app-level token's scope is `connections:write`. There is no `im:write`: the account posts into the DM channel it heard the operator in, which needs only `chat:write`. `users:read` covers `users.info` (sheet 3's name) and `bots.info` (the pair check, ruling 7).
  7. **The pair check.** Sheet 1's Next runs, in order:
     - `auth.test` with the bot token;
     - `bots.info(bot_id)` for the bot's app id;
     - `apps.connections.open` with the app token;
     - the socket, waiting up to 10 s for `hello`;
     - a check that `hello.connection_info.app_id` equals the bot's app id.

     A pair from two apps is refused in fixed words. Why: a socket for another app would hear nothing, and the sheet would wait for ten minutes for no reason.
  8. **The conflict.** A `hello` with `num_connections` > 1 means another process holds this app's socket, and Slack spreads the events across all of them. While pending, the state is `conflict`; while connected, the status says `conflictAt` with one line a minute. Why: this is the analogue of Telegram's 409. The connector always closes its own socket before it opens the next one (on `refresh_requested`, the 30-minute refresh, and every reconnect), so its own sockets never count twice; and a reading of > 1 within 30 s of its own close is taken only when the next `hello` (or a recheck 30 s later via a fresh `apps.connections.open`) still reads > 1 — Slack can report the closed socket for a few seconds. Test in Task 4: `a reconnect's own old socket is not a conflict; a second holder is`. (Controller's ruling on review.)
  9. **The socket's life.**
     - On a `disconnect` envelope: reconnect at once on `refresh_requested`; take no action on `warning`; on `link_disabled`, stop with `pollFailing: "Socket Mode is off for this app"`.
     - On a close: back off 5 s, doubling to 60 s.
     - A socket that has carried no frame for 30 minutes is reopened (`SOCKET_REFRESH_MS`), and the next `hello`'s backfill takes whatever a half-open socket missed.
  10. **Web API calls.** Each call is a `POST` of `application/x-www-form-urlencoded` (every method takes it) with `Authorization: Bearer <token>` and a 15 s deadline. An answer with `ok: false` is a `SlackApiError` with Slack's `error` code.
      - HTTP 429 and `ratelimited`, `service_unavailable`, `request_timeout`, `fatal_error`, and a network failure: retryable, and queued in the outbox.
      - `invalid_auth`, `token_revoked`, `account_inactive`, `not_authed`: the status reads `pollFailing` with that code, and the message is dropped.
      - Every other code (`channel_not_found`, `msg_too_long`, `cannot_dm_bot` and so on): refused, dropped with one line.
      - The token is never in a URL.
  11. **The manifest comes from the account,** as spec §5.7 says. It is the `SLACK_MANIFEST` text in `slack-api.ts`, carried in `GET /api/account/identity` as `slackManifest`. This adds no route: the tab already reads that answer.
  12. **The phone's records keep their name.** The desk's source kind stays `telegram` (the ledger, session logs and the carry read it). It gains `network?: string`, and the provenance line shows the network: `[slack · operator · 14:03 ET]`.
      - A phone turn's answer goes to the network of the message that named the turn (`DeskTurnRecord.message.network`).
      - A line with no such message (a restart's cut-turn line) goes as `chat` with no network, which the account sends to every network the Chat row ticks.
      - `writeOff` and `writeMute` record `by` as the network the command came from.
  13. **The watchdog.** While the account is down, it reads Telegram's file first. Only when Telegram is not connected does it read Slack's (`botToken` and `channel`) and send the one account-down line with `chat.postMessage`. It sends one line, on one network. Why: §5.10's one line, through the network most likely to wake the phone. A Slack-only operator still hears it.

## Review Focus

- **The account is down (or the socket is half-open) while the operator writes on Slack.** Nothing is lost and nothing is taken twice. The next `hello`'s backfill appends each text from the cursor once. A live envelope for a text the backfill took is acked and not stored again. The cursor moves only after an append. Tests in Task 4: `a text written while no socket was open is taken from the history once` and `a text the inbox cannot store is not acked, and its retry is stored once`.
- **Someone other than the operator, or something other than the DM.** A second workspace member's DM is counted in Not you and never stored or answered. A channel or mpim message, a bot's message (`bot_id` or `subtype: bot_message`), an edit or a deletion, and an envelope from another team or app are dropped and never stored. Test in Task 4: `a stranger is counted, never stored, never answered; a channel, a bot, an edit and another team are dropped`.
- **A token in a place it must not be.** After a full Slack connect, both tokens are in `credentials/networks/slack.json` and in nothing else: no ledger row, log line, answer, other file, proxy log, or text sent. A text holding a token of any Slack shape arrives as `<token>`. A socket URL from another host is refused, so the app token never opens a socket there. Tests in Task 3 (`the two tokens are in credentials/networks/slack.json and nowhere else`, `a socket URL off slack.com is refused`) and Task 5 (`every Slack token shape is taken out of what is sent and what is logged`).
- **A Slack text answered on Telegram.** With both networks connected, a Slack text's answer and its command replies go to Slack, and a Telegram text's to Telegram. A proactive kind goes to each network its row ticks. Test in Task 6: `a Slack text's answer goes back to Slack, a Telegram text's to Telegram`.
- **A text that would format or link on Slack.** `<!channel>`, `<https://evil.example|ok>`, `*bold*` and `a & b` arrive as literal characters, escaped, with unfurls off. A card or fill notice's host is defanged as on Telegram. Test in Task 5: `what is sent is escaped, plain and unfurled nowhere`.

---

## File Structure

**account/src/portfolio/identity/**
- Modify:
  - `kinds.ts`: `Network`, `NETWORKS`, `WIRE_ID`, `SLACK_TOKEN_ANYWHERE`, `chatOffLine`.
  - `store.ts`: `maskId` is unchanged; `MASKED` moves here.
  - `secret-file.ts`: the `NetworkSecret` union.
  - `pending.ts`: the `PendingSource` seam.
  - `telegram.ts`: `TelegramPendingSource`, `TelegramTransport`; `TelegramConnector` implements `Connector`.
  - `identity.ts`: `Transport` and `Connector` by network.
  - `routes.ts`: the Slack token route and new words.
- Create:
  - `slack-api.ts`: `SlackApi`, `SlackApiError`, `slackApiBase`, `socketUrlOk`, `SLACK_MANIFEST`, `escapeSlack`.
  - `slack-socket.ts`: `SlackSocket`, `SocketLike`, `openSocket`.
  - `slack.ts`: `SlackPendingSource`, `SlackConnector`, `SlackTransport`, `normalizeCommand`.
- Modify: `account/src/portfolio/server.ts` (the JSON parser skips the Slack token route), `service.ts` (`identity.slackApiBase`, `openSocket`), `account/README.md`.
- Tests:
  - `account/test/identity-fakes.ts` gains `fakeSlack` and `slackTokens`.
  - New: `account/test/unit/identity-slack-api.test.ts`, `identity-slack-pending.test.ts`, `identity-slack-inbox.test.ts`, `identity-slack-send.test.ts`.
  - Extend: `identity-store`, `identity-sign`, `identity-send`.

**face/**
- Modify:
  - `src/account-proxy.ts`: the `identitySlackToken` write.
  - `src/phone.ts`: `WIRE_ID`.
  - `src/desk-conversation.ts`: the reply network.
  - `src/desk-session.ts`: `DeskSource.network` and the provenance line.
  - `src/phone-bridge.ts`: posts `network`; `by`.
  - `src/desk.ts`: `by` gains `slack`.
  - `scripts/watchdog.ts`: the Slack fallback.
  - `../dsh/profile/desk.md`: one line.
- Client:
  - `client/js/host/identity-view.js`, `host/identity.js`, `host/sheet-identity.js`, `render/identity.js`, `reducers/identity.js`.
- Tests: extend `account-proxy`, `phone-bridge`, `desk-conversation`, `desk-session`, `watchdog`, `cycle` (desk.md), `client/identity-view`, `client/identity-host`, `client/sheet-identity`, and `gravit-client-smoke`.

**Docs:** `Gravit-Design.md`, `DEVELOPMENT.md`, `CLAUDE.md`, `face/README.md`, `account/README.md`, and `Gravit-Docs-and-Prompt-Loops.html`.

---

### Task 1: B1's seams, made for a second network (Telegram unchanged)

**Files:**
- Modify: `account/src/portfolio/identity/kinds.ts`, `store.ts`, `secret-file.ts`, `pending.ts`, `telegram.ts`, `identity.ts`, `routes.ts`
- Test: `account/test/unit/identity-store.test.ts`, `identity-sign.test.ts`, `identity-send.test.ts` (each case that pins "slack is refused" moves to `imessage`), plus a new `identity-seams.test.ts`

The seams, by file and symbol, each generalised where B1 hard-coded Telegram:
- `kinds.ts`:
  - `Network = "telegram"` and `NETWORKS = ["telegram"]` widen to include `"slack"`.
  - It gains `WIRE_ID`, which replaces `identity.ts` `REPLY_TO` and the `/^[a-z]{1,16}:\d{1,16}$/` copy in `routes.ts` `sendOf`.
  - It gains `chatOffLine(network)`, which replaces `telegram.ts` `CHAT_OFF`.
- `store.ts`: B1's `MASKED` (`identity.ts`, digits only) becomes `/^…[0-9A-Z]{1,3}$/` and moves beside `maskId`.
- `secret-file.ts`: B1's single `NetworkSecret` becomes `TelegramSecret | SlackSecret`, `FIELDS` becomes per network, and `readNetworkSecret` gains overloads.
- `pending.ts`:
  - `PendingConnections` keeps the shell: one pending entry, expiry, `view`, `notMe`, `drop`, `peek`, `take`.
  - The Telegram-only `begin`, `loop` and `senderOf` move behind `PendingSource`, as `telegram.ts` `TelegramPendingSource`.
  - `noteStranger("telegram", …)` takes the entry's network.
  - `PendingView.network` and `PendingTaken` widen.
- `identity.ts`:
  - `Link` becomes `Transport`.
  - `connectors: Map<Network, TelegramConnector>` becomes `Map<Network, Connector>`.
  - `startConnector` dispatches by network.
  - `readOffset` becomes the connector's own `resumeFrom`.
  - `isRefused(BotApiError …)` becomes `Transport.classify`.
  - `NETWORK_NAME` gains Slack.
  - `TOKEN_ANYWHERE` (in `identitySignedProblem`) also matches `SLACK_TOKEN_ANYWHERE`.
  - `clean` redacts every transport's `secrets` and then the Slack shapes.
  - The pending's `bound` asks the network being begun.
- `routes.ts`: `IDENTITY_WORDS` loses the Telegram-only `network` sentence. It gains `networkUnknown`, and `connected`/`notConnected` become `connectedOn(network)` and `notConnectedOn(network)`, which are functions returning fixed sentences.

**Interfaces:**
- Produces:
  - `type Network = "slack" | "telegram"`; `const NETWORKS: readonly Network[] = ["telegram", "slack"]`; `const WIRE_ID: RegExp`; `const SLACK_TOKEN_ANYWHERE: RegExp` (global); `chatOffLine(network: Network): string`, which gives `Chat with Gravit is off on Slack: Account › Identity turns it on.`
  - `type TelegramSecret = { token; botId; username; operatorId; operatorHandle }`; `type SlackSecret = { appToken; botToken; appId; channel; botId; username; operatorId; operatorHandle }`.
  - `writeNetworkSecret<N extends Network>(home: string, network: N, content: SecretOf<N>)`; `readNetworkSecret<N extends Network>(home: string, network: N): SecretOf<N> | undefined`; `secretsOf(s: TelegramSecret | SlackSecret): string[]` (the token strings to redact).
  - The pending source:

    ```ts
    interface PendingSource {
      network: Network;
      secrets: readonly string[];
      check(signal: AbortSignal): Promise<PendingBot | Refusal>;
      listen(ctx: { signal: AbortSignal; admit(senderId: string): "hear" | "stranger" | "drop"; heard(s: PendingSender): void; conflict(on: boolean): void; log(l: string): void }): Promise<void>;
      resume(): PendingResume;
    }
    ```

    with `PendingBot = { id: string; username: string; name: string; link: string; workspace?: string }`, `PendingSender = { id: string; name: string; handle: string; masked: string; text: string }`, and `PendingResume = { network: "telegram"; offset: number } | { network: "slack"; appId: string; channel: string; cursor: string }`.
  - `PendingConnections.begin(network: Network, source: PendingSource, keyInput: string, keyHash: string, salt: string): Promise<PendingView | Refusal>`. `keyInput` is the string `keyMatches` hashes: the token for Telegram, `app + "\0" + bot` for Slack.
  - `PendingTaken = { network: Network; keyInput: string; keyHash: string; salt: string; bot: PendingBot; sender: { id: string; handle: string }; resume: PendingResume; secret: TelegramSecret | SlackSecret }`.
  - The transport and the connector:

    ```ts
    interface Transport {
      network: Network;
      secrets: readonly string[];
      partMax: number;
      send(part: string, replyTo?: string): Promise<string>;
      classify(err: unknown): "retry" | "refused" | "blocked" | "auth";
      dispose(): void;
    }
    interface Connector {
      start(): void;
      status(): NetworkStatus;
      setBlocked(b: boolean): void;
      dispose(): Promise<void>;
    }
    ```

    `send` answers the wire id. `TelegramConnector implements Connector`; `TelegramTransport implements Transport`.

- [ ] **Step 0:** Record the three suites' counts at `main` in the task's notes.
- [ ] **Step 1: Write the failing tests** in `identity-seams.test.ts`:

```ts
it("the wire id takes Telegram's numbers and Slack's ts, nothing else", () => {
  for (const ok of ["telegram:41", "slack:1730812345.001200"]) expect(WIRE_ID.test(ok)).toBe(true);
  for (const no of ["slack:41", "slack:D0123:1730812345.001200", "imessage:1", "telegram:4.1", "41"]) expect(WIRE_ID.test(no)).toBe(false);
});
it("routing knows slack; a network the account does not speak on is refused", () => {
  expect(formatRouting(parseRouting("chat=slack,telegram;alerts=telegram;brief=;cards=;fills=") as Routing)).toBe("chat=slack,telegram;alerts=telegram;brief=;cards=;fills=");
  expect(parseRouting("chat=imessage;alerts=;brief=;cards=;fills=")).toMatch(/imessage/);
  expect(parseRouting("chat=telegram,slack;alerts=;brief=;cards=;fills=")).toMatch(/sorted/);
});
it("Slack's token file keeps both tokens under the same rules, and reads back as Slack's shape", () => {
  /* writeNetworkSecret(home, "slack", SLACK_SECRET) → 0600 in 0700; readNetworkSecret(home, "slack") deep-equals it;
     readNetworkSecret(home, "telegram") stays undefined; secretsOf(SLACK_SECRET) is [appToken, botToken] */
});
it("a Slack masked id is blockable", () => { expect(MASKED.test("…7QK")).toBe(true); expect(MASKED.test("…7qk")).toBe(false); });
it("a Slack token in any signed field is refused before the door writes", () => {
  expect(identitySignedProblem({ type: "setRouting", routing: slackTokens().bot, quietFrom: "", quietTo: "", nonce: 1 } as IdentityAction)).toBe(IDENTITY_WORDS.tokenInField);
});
it("chatOffLine names the network", () => { expect(chatOffLine("slack")).toBe("Chat with Gravit is off on Slack: Account › Identity turns it on."); });
```

Also add `slackTokens(): { app: string; bot: string; user: string; refresh: string }` to `identity-fakes.ts` now: four made-up tokens built by concatenation, shaped as the constraints say. Every B1 identity test runs unchanged except the three cases that pinned `slack` as the refused network, which now pin `imessage`.

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-seams.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the seams** as listed above. `TelegramPendingSource` is B1's `begin` checks (`getMe`) and `loop` body, moved as they are. `TelegramTransport` is B1's `Link` and `deliver`'s single-part send (`partMax` 4,000; `classify`: 400 → refused, 403 → blocked, anything else → retry). `Identity.deliver` loops parts through `transport.send` and maps `classify` onto B1's three outcomes: drop, `setBlocked`, queue. `auth` is dropped with one line and sets the status's `pollFailing`.
- [ ] **Step 4: Run** the new file, then every `identity-*` file, the whole account suite and typecheck. Expected: green, and every B1 identity case passes with Telegram's numbers as before.
- [ ] **Step 5: Commit**: `refactor(account): identity seams for a second network - a pending source, a transport and a connector per network, the wire id and the token file as unions; Telegram unchanged`.

---

### Task 2: The Slack Web API, the Socket Mode link and the fake Slack

**Files:**
- Create: `account/src/portfolio/identity/slack-api.ts`, `slack-socket.ts`
- Modify: `account/test/identity-fakes.ts` (`fakeSlack`)
- Test: `account/test/unit/identity-slack-api.test.ts`

**Interfaces:**
- Produces:
  - The client:

    ```ts
    class SlackApi {
      constructor(o: { token: string; apiBase: string; fetch?: typeof fetch; signal?: AbortSignal });
      authTest(): Promise<{ teamId: string; team: string; userId: string; user: string; botId: string }>;
      botsInfo(botId: string): Promise<{ appId: string; name: string }>;
      usersInfo(userId: string): Promise<{ name: string; displayName: string; realName: string; isBot: boolean }>;
      connectionsOpen(): Promise<string>;
      history(channel: string, oldest: string, limit: number, cursor?: string): Promise<{ messages: unknown[]; next?: string }>;
      postMessage(channel: string, text: string): Promise<string>;
    }
    class SlackApiError extends Error { status: number; code: string; retryAfterS?: number }
    ```

    `connectionsOpen` answers the socket URL; `postMessage` answers the new message's `ts`.
  - `slackApiBase(env: NodeJS.ProcessEnv, log: (l: string) => void): string` (the `ACCOUNT_SLACK_API` loopback override).
  - `socketUrlOk(url: string, apiBase: string): boolean` (the constraints' rule).
  - `escapeSlack(text: string): string`.
  - `const SLACK_MANIFEST: string`. It is pretty-printed JSON: `display_information.name` `Gravit`; `features.app_home` with `messages_tab_enabled: true`, `messages_tab_read_only_enabled: false` and `home_tab_enabled: false`; `features.bot_user` `{display_name: "Gravit", always_online: true}`; `oauth_config.scopes.bot` `["chat:write", "im:history", "users:read"]`; `settings` with `event_subscriptions.bot_events` `["message.im"]`, `socket_mode_enabled: true`, `interactivity.is_enabled: false`, `org_deploy_enabled: false` and `token_rotation_enabled: false`.
  - The socket:

    ```ts
    type SocketLike = Pick<WebSocket, "send" | "close" | "readyState" | "addEventListener">;
    type OpenSocket = (url: string) => SocketLike;
    class SlackSocket {
      constructor(o: { api: SlackApi; apiBase: string; open?: OpenSocket; clock: IdentityClock; log: (l: string) => void });
      run(on: { hello(h: { appId: string; connections: number }): Promise<void>; envelope(e: Envelope): Promise<"ack" | "hold">; down(reason: string): void }): void;
      status(): { open: boolean; lastFrameAt?: string; failing?: { since: string; reason: string } };
      dispose(): Promise<void>;
    }
    ```

    with `Envelope = { envelopeId: string; type: string; payload: unknown; retryAttempt: number }`. The default `open` is `(url) => new WebSocket(url)`. A `hello` handler finishes before any envelope is handled; envelopes are handled one at a time, in order. `"ack"` sends `{"envelope_id": …}`; `"hold"` sends nothing.
  - The test helper:

    ```ts
    fakeSlack(o?): Promise<{
      url: string;
      tokens: { app: string; bot: string };
      team: { id: string; name: string };
      bot: { userId: string; botId: string; appId: string; name: string };
      users: Map<string, { name: string; displayName: string; realName: string }>;
      push(envelope: object): void;
      history: Array<{ ts: string; user: string; text: string; subtype?: string; bot_id?: string; thread_ts?: string }>;
      acks: string[];
      posted: Array<{ channel: string; text: string; mrkdwn: string; unfurl_links: string; unfurl_media: string; thread_ts?: string }>;
      sockets(): number;
      disconnect(reason: string): void;
      drop(): void;
      helloConnections(n: number): void;
      answer(method: string, status: number, body: object): void;
      socketUrl(url: string): void;
      close(): Promise<void>;
    }>
    ```

    It is one `node:http` server on 127.0.0.1:0. `/api/<method>` checks `Authorization: Bearer` against the fake's tokens (`invalid_auth` otherwise) and parses the form body. An upgrade on `/link` is a hand-rolled RFC 6455 server: the `Sec-WebSocket-Accept` handshake, unmasked text frames to the client, masked client frames decoded, and a close frame. It sends `hello` on open and records every ack's `envelope_id`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("each call is a form POST with the token in Authorization, never in the URL", async () => { /* fake records method, content-type x-www-form-urlencoded, header; no request URL contains either token */ });
it("ok:false is a SlackApiError with Slack's code; 429 carries Retry-After", async () => {});
it("the base takes only a loopback http override; the socket URL only slack.com's wss or that loopback port", () => {
  expect(slackApiBase({ ACCOUNT_SLACK_API: "https://evil.example" }, log)).toBe("https://slack.com/api");
  expect(socketUrlOk("wss://wss-primary.slack.com/link/?ticket=x", "https://slack.com/api")).toBe(true);
  expect(socketUrlOk("wss://slack.com.evil.example/link", "https://slack.com/api")).toBe(false);
  expect(socketUrlOk("ws://127.0.0.1:9/link", "http://127.0.0.1:8/api")).toBe(false);
});
it("escapeSlack escapes &, < and > and nothing else", () => { expect(escapeSlack("<!channel> a & b <https://x|y>")).toBe("&lt;!channel&gt; a &amp; b &lt;https://x|y&gt;"); });
it("the manifest is Socket Mode, a bot user, the DM tab writable, three bot scopes and message.im", () => { /* JSON.parse(SLACK_MANIFEST) fields as the Interfaces list */ });
it("the socket: hello first, then envelopes in order; ack sends the envelope_id; hold sends nothing", async () => { /* over fakeSlack with the real global WebSocket */ });
it("refresh_requested reconnects at once; a close backs off 5 s doubling to 60 s; link_disabled stops and says so", async () => {});
it("a socket silent for 30 minutes is reopened", async () => { /* injected clock */ });
it("account/src names slack.com in identity/slack-api.ts alone", () => {});
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-slack-api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The client's deadline is 15 s; `connectionsOpen` uses the app token, everything else the bot token.
  - `SlackApiError.message` never carries a token: it is redacted with `redactorOf` and the Slack shapes.
  - The socket logs at most one line a minute for repeated failures, as B1's `RECORD_EVERY_MS` does.
  - Frames over 64 KiB are dropped with one line.
  - A frame that is not JSON is dropped.
- [ ] **Step 4: Run** the file, the whole account suite and typecheck. Expected: green.
- [ ] **Step 5: Commit**: `feat(account): the Slack Web API and one Socket Mode link over Node's own WebSocket, with a fake Slack on loopback - no new dependency`.

---

### Task 3: Connect Slack, sheets 1 to 3 and the signature, on the account

**Files:**
- Create: `account/src/portfolio/identity/slack.ts` (`SlackPendingSource`)
- Modify: `routes.ts` (the Slack token route, `slackManifest` in the view), `identity.ts` (connect writes `slack.json`; the view), `server.ts` (`isIdentityTokenPath` covers both token routes), `service.ts` (`identity.slackApiBase`, `identity.openSocket` for tests)
- Test: `account/test/unit/identity-slack-pending.test.ts`; `identity-sign.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `PendingSource` and `PendingConnections`; Task 2's `SlackApi`, `SlackSocket` and `fakeSlack`.
- Produces:
  - The route `POST /api/account/identity/slack/token` takes `{appToken, botToken, keyHash, salt}`, exactly those four strings, at most 1,024 bytes of `application/json`, read by its own reader. `SLACK_TOKEN_PATH`; `isIdentityTokenPath(path)` is true for both networks' paths.
  - `parseSlackTokenBody(raw: Buffer): { ok: true; appToken: string; botToken: string; keyHash: string; salt: string } | { ok: false }`. It zeroes the buffer.
  - `class SlackPendingSource implements PendingSource { constructor(o: { appToken: string; botToken: string; apiBase: string; fetch?: typeof fetch; open?: OpenSocket; clock: IdentityClock; log }) }`.
  - `PendingView` for Slack:
    - `network: "slack"`;
    - `bot: { id: "<team>:<bot user>", username: <bot user name>, name: <bots.info name> }`;
    - `workspace: <team name>`;
    - `link: "https://slack.com/app_redirect?app=<app id>&team=<team id>"`;
    - `qr`: B1's `qrOf` of that link.
  - `IdentityView.slackManifest: string`.
  - New `IDENTITY_WORDS`, all fixed and never repeating input:
    - `slackMalformed`: `This route takes one JSON object, {appToken, botToken, keyHash, salt}: what was sent is not that, and it was not kept.`
    - `slackTokenShape`: `Those are not a Slack app's tokens: the first starts xapp-, the second xoxb-. Nothing was kept.`
    - `refusedBySlack`: `Slack does not know this bot token: nothing was kept. Copy it from Install App again.`
    - `slackNoSocket`: `Slack would not open a socket for the app-level token: give it the connections:write scope and turn Socket Mode on. Nothing was kept.`
    - `slackPairMismatch`: `The two tokens belong to two different Slack apps: nothing was kept. Copy both from the same app.`
    - `slackUnreachable`: `Slack did not answer: nothing was kept. Try again in a minute.`

- [ ] **Step 1: Write the failing tests** (boot as `identity-pending.test.ts` does, with `identity: { slackApiBase: slack.url, pollTimeoutS: 1 }`):

```ts
it("a token pair Slack knows becomes a pending connection; the answer names the app, never a token", async () => {
  const { salt, keyHash } = fp(`${slack.tokens.app}\u0000${slack.tokens.bot}`);
  const r = await send(srv.url, "/api/account/identity/slack/token", { body: JSON.stringify({ appToken: slack.tokens.app, botToken: slack.tokens.bot, keyHash, salt }) });
  const p = JSON.parse(r.text).pending;
  expect(p).toMatchObject({ network: "slack", bot: { id: "T0FAKE001:U0BOT0001", username: "gravit" }, workspace: "Fake Co", link: "https://slack.com/app_redirect?app=A0FAKE001&team=T0FAKE001", state: "waiting" });
  expect(p.qr.startsWith("data:image/svg+xml;base64,")).toBe(true);
  for (const t of [slack.tokens.app, slack.tokens.bot]) expect(r.text).not.toContain(t);
});
it("a bad shape, an unknown bot token, an app token without Socket Mode, a pair from two apps and a fingerprint of other tokens are refused in fixed words, nothing kept", async () => {});
it("a socket URL off slack.com is refused", async () => { /* slack.socketUrl("ws://127.0.0.2:1/link") → 502 slackUnreachable, one log line, the fake saw no socket */ });
it("the first DM from a person is heard: name, handle, masked id and text; the heard envelope is acked", async () => {
  slack.push(dm({ user: "U0PAN07QK", text: "hi" }));
  await until(() => view().state === "heard");
  expect(view().sender).toEqual({ id: "T0FAKE001:U0PAN07QK", name: "Pan", handle: "@pan", masked: "…7QK", text: "hi" });
});
it("a channel message, a bot's message and an edit are not heard while pending", async () => {});
it("Not me counts the sender as a Slack stranger and waits again", async () => {});
it("a hello with two connections is state conflict", async () => { slack.helloConnections(2); /* → "conflict" */ });
it("drop or expiry closes the socket and forgets both tokens", async () => { /* slack.sockets() back to 0 */ });
it("a Slack pending is refused while Slack is connected; Telegram's pending is untouched by Slack's", async () => {});
// identity-sign.test.ts
it("connect Slack: the door checks the pair against the signed fingerprint, then stores both tokens, the channel and the binding", async () => {
  /* own({type:"connectNetwork", network:"slack", pending, botId:"T0FAKE001:U0BOT0001", speaksAs:"@gravit", operatorId:"T0FAKE001:U0PAN07QK", talksOnlyWith:"@pan", routing:"chat=slack;alerts=slack;brief=slack;cards=slack;fills=slack", keyHash, salt})
     → readNetworkSecret(home, "slack") has appToken, botToken, appId "A0FAKE001", channel "D0FAKEDM1"; view().networks has slack with fingerprint keyHash.slice(0,8) */
});
it("the two tokens are in credentials/networks/slack.json and nowhere else", async () => {
  /* walk the home: only slack.json holds either token; the ledger has the fingerprint, not keyHash, salt or a token; console spies saw neither */
});
it("no file in account/ or face/ holds a literal Slack token of scanner shape", () => { /* walk both trees, skipping node_modules */ });
it("the identity view carries the Slack manifest", async () => { expect(JSON.parse((await get("/api/account/identity")).slackManifest).settings.socket_mode_enabled).toBe(true); });
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-slack-pending.test.ts test/unit/identity-sign.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Slack token route mirrors B1's Telegram route: content type and encoding, `readSmall(req, 1024)`, the parser, then shapes, then `keyMatches`, then `begin`.
  - `SlackPendingSource.check` runs ruling 7's order. Its `listen` hears the first `message` event with `channel_type: "im"`, no `subtype`, no `bot_id`, a `user`, and `team_id` and `api_app_id` the pair's. It asks `users.info` for the name and handle (an `is_bot` user is dropped), records `channel` and `ts` as `resume.cursor`, acks, and closes the socket.
  - The connect door is B1's `Identity.connect`, with `writeNetworkSecret(home, "slack", …)` from `taken.secret`. `startConnector` for Slack is a no-op hook until Task 4.
  - The ledger summary reads `Slack connected: Gravit speaks as @gravit and talks only with @pan · tokens ab12cd34`.
- [ ] **Step 4: Run** both files, the whole account suite and typecheck. Expected: green.
- [ ] **Step 5: Commit**: `feat(account): connect Slack - the app's two tokens checked with auth.test, bots.info and a socket's hello, held in memory, the first DM heard, signed as one fingerprint`.

---

### Task 4: The Slack connector — the DM into the inbox, the backfill, strangers and commands

**Files:**
- Modify: `account/src/portfolio/identity/slack.ts` (`SlackConnector`, `normalizeCommand`), `identity.ts` (start and resume Slack's connector, with `slack.cursor`)
- Test: `account/test/unit/identity-slack-inbox.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; B1's `InboxRing`, `Strangers` and `writeIdentityFile`.
- Produces:
  - `class SlackConnector implements Connector { constructor(d: { home; api: SlackApi; socket: SlackSocket; binding: Binding; secret: SlackSecret; inbox: InboxRing; strangers: Strangers; blocked: () => string[]; chatOn: () => boolean; reply: (text: string) => Promise<void>; cursor: string | undefined; clock: IdentityClock; log }) }`.
  - `normalizeCommand(text: string): string`. It rewrites `!status`, `!pause …`, `!mute …`, `!new` and `!stop` (case-insensitive, after trimming) to the same text with `/`, and leaves every other text alone.
  - `CURSOR_FILE = "slack.cursor"`.
  - `NetworkStatus` for Slack:
    - `polling` is the socket open past `hello`;
    - `lastPollAt` is the last frame;
    - `conflictAt` is `num_connections` > 1;
    - `pollFailing` is a failing open or an `auth` code.

- [ ] **Step 1: Write the failing tests** (connected through Task 3's flow over `fakeSlack`):

```ts
it("the operator's DM is stored, then acked, with its ts as the id and a thread's root as replyTo", async () => {
  slack.push(dm({ user: OP, text: "how is NVDA", ts: "1730812345.001200", thread_ts: "1730812000.000100" }));
  const a = await inbox(0, 5);
  expect(a.messages).toEqual([{ id: 1, network: "slack", messageId: "slack:1730812345.001200", replyTo: "slack:1730812000.000100", text: "how is NVDA", at: "2024-11-05T13:12:25.001Z" }]);
  expect(slack.acks).toContain(lastEnvelopeId());
  expect(readFileSync(join(home, "identity", "slack.cursor"), "utf8").trim()).toBe("1730812345.001200");
});
it("a text the inbox cannot store is not acked, and its retry is stored once", async () => { /* inbox.json made a link → no ack; restore; push the same envelope with retry_attempt 1 → one message, acked */ });
it("a text written while no socket was open is taken from the history once", async () => {
  /* slack.drop(); slack.history.push(op text ts T1); a live envelope for T1 arrives after the next hello too → inbox has T1 once; cursor T1 */
});
it("the backfill starts after the cursor and stops at 500, oldest first", async () => {});
it("a stranger is counted, never stored, never answered; a channel, a bot, an edit and another team are dropped", async () => {
  /* DM from U0OTHER01 → strangers count 1, inbox empty, slack.posted empty; channel_type "channel", "mpim", bot_id, subtype "message_changed", team_id other → nothing; every one acked */
});
it("a file from the operator gets 'text only, please'; a blocked stranger is not counted", async () => {});
it("!status reaches the inbox as /status even with Chat off; plain text with Chat off gets the Slack line", async () => {
  /* setRouting chat= → push "!pause 30m" → inbox text "/pause 30m"; push "hello" → posted text "Chat with Gravit is off on Slack: Account › Identity turns it on." */
});
it("a second connection is recorded as conflict once a minute", async () => {});
it("a restarted account resumes Slack from the cursor with the file's tokens", async () => {});
it("disconnect closes the socket and removes slack.json; Telegram's connection is untouched", async () => {});
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-slack-inbox.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** rulings 1, 2, 5, 8 and 9.
  - The filter for a stored text: an `events_api` envelope with `api_app_id` equal to `secret.appId` and `team_id` equal to the binding's team, holding an `event` of type `message` with `channel_type: "im"`, `channel` equal to `secret.channel`, `user` equal to the operator's user id, no `bot_id` and no `subtype`. A `subtype` of `file_share` from the operator is answered `text only, please`. Any other subtype is dropped.
  - A backfilled history row goes through the same filter, read as the event it would have been.
  - `at` is `ts` × 1000 as ISO.
  - The inbox's `bot` is `binding.botId`.
- [ ] **Step 4: Run** the file, every `identity-*` file, the whole account suite and typecheck. Expected: green.
- [ ] **Step 5: Commit**: `feat(account): the Slack connector - the operator's DM into the inbox, acked after it is stored, backfilled from a cursor at every hello, strangers counted, ! commands`.

---

### Task 5: Sending on Slack

**Files:**
- Modify: `account/src/portfolio/identity/slack.ts` (`SlackTransport`), `identity.ts` (`clean` adds the Slack shapes; the log redactor covers both networks' secrets)
- Test: `account/test/unit/identity-slack-send.test.ts`; `identity-send.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1's `Transport`; Task 2's `SlackApi.postMessage` and `escapeSlack`.
- Produces: `class SlackTransport implements Transport { constructor(o: { api: SlackApi; channel: string; secrets: readonly string[] }) }`.
  - `partMax` is 4,000.
  - `send` escapes the part and calls `postMessage(channel, escaped)` with `mrkdwn=false`, `unfurl_links=false` and `unfurl_media=false`, and answers `slack:<ts>`. `replyTo` is accepted and not sent (ruling 3).
  - `classify` follows ruling 10.

- [ ] **Step 1: Write the failing tests:**

```ts
it("a reply to a Slack text goes to Slack's DM, top level, ids prefixed", async () => {
  const r = await post("/api/account/identity/send", { kind: "chat", text: "NVDA is 183", network: "slack", replyTo: "slack:1730812345.001200" });
  expect(r).toEqual({ ok: true, sent: [`slack:${slack.posted.at(-1)!.ts}`] });
  expect(slack.posted.at(-1)).toMatchObject({ channel: "D0FAKEDM1", text: "NVDA is 183", mrkdwn: "false", unfurl_links: "false", unfurl_media: "false" });
  expect(slack.posted.at(-1)!.thread_ts).toBeUndefined();
});
it("what is sent is escaped, plain and unfurled nowhere", async () => {
  /* text "<!channel> <https://evil.example|ok> *bold* a & b" → posted text "&lt;!channel&gt; &lt;https://evil.example|ok&gt; *bold* a &amp; b" */
});
it("every Slack token shape is taken out of what is sent and what is logged", async () => {
  /* text holding slack.tokens.bot, slack.tokens.app, slackTokens().user and .refresh → posted text has four "<token>" and none of them; a SlackApiError line logged has none */
});
it("with both networks connected, alerts go to each ticked network and a reply only to its own", async () => {});
it("quiet hours, not routed and the watchdog behave on Slack as on Telegram", async () => {});
it("a 429 and a network failure wait in the outbox and go first; channel_not_found is dropped; token_revoked reads pollFailing", async () => {});
it("a fill and a Guard card notice reach Slack, defanged, with no link", async () => {});
```

- [ ] **Step 2: Run** `cd account && npx vitest run test/unit/identity-slack-send.test.ts test/unit/identity-send.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - B1's `send`, `flush` and `outbox` are unchanged except through `Transport`.
  - `clean` = B1's exact-spelling redactor over every transport's `secrets`, then `SLACK_TOKEN_ANYWHERE` → `<token>`, then `withoutLocalLinks`.
  - The identity's own `log` passes every line through the same two redactors.
- [ ] **Step 4: Run** both files, the whole account suite and typecheck. Expected: green.
- [ ] **Step 5: Commit**: `feat(account): send on Slack - chat.postMessage to the bound DM, escaped and plain, both tokens and every Slack token shape taken out, the outbox and notices as on Telegram`.

---

### Task 6: The face — the Slack token route, the wire id, the reply's network, and the watchdog

**Files:**
- Modify:
  - `face/src/account-proxy.ts`;
  - `face/src/phone.ts` (`WIRE_ID` is the account's rule);
  - `face/src/desk-conversation.ts`: `DELIVERED` and `PHONE_LINE` hard-code `network: "telegram"`. The answer's network is now read from `r.message.network` when it is a known network string; else it is omitted (ruling 12).
  - `face/src/desk-session.ts` (`DeskSource` `telegram` gains `network?: string`; `provenanceLine`);
  - `face/src/phone-bridge.ts` (posts `source.network`; `writeOff` and `writeMute` `by: m.network`);
  - `face/src/desk.ts` (`by` and `setters` gain `slack`);
  - `face/scripts/watchdog.ts`;
  - `dsh/profile/desk.md`.
- Test: `face/tests/account-proxy.test.ts`, `phone-bridge.test.ts`, `desk-conversation.test.ts`, `desk-session.test.ts`, `desk.test.ts`, `watchdog.test.ts`, `cycle.test.ts` (extend each); `face/tests/fake-phone-account.ts` (pushes Slack ids)

**Interfaces:**
- Produces:
  - `WriteRoute` gains `"identitySlackToken"`: face path `identity/slack/token`, account path `/api/account/identity/slack/token`, limit 1,024, abort 30,000. The module header's counts become 44 routes: 25 reads, 16 writes, 2 streams and the callback.
  - `provenanceLine({ kind: "telegram", network: "slack", at }, now)` gives `[slack · operator · 14:03 ET]`. With no network it is `telegram`, as before.
  - `readNetworkFile(accountHome: string, network: "telegram" | "slack")` replaces `readTelegramFile`. It returns `{ token, operatorId } | { botToken, channel } | { why }`. `phoneDirectOf` tries Telegram, then Slack.
  - `desk.md` line 6 becomes: `- [telegram · operator · 14:03 ET] or [slack · operator · 14:03 ET] is the operator writing from their phone; "(carried over a restart)" after the time means the face sent it again after a restart.`

- [ ] **Step 1: Write the failing tests:**

```ts
// account-proxy.test.ts
test("the Slack token route forwards the body as it came and keeps nothing", async () => { /* stub received identical bytes; no captured log line holds either token */ });
// phone-bridge.test.ts
test("a Slack text is posted with its network and answered on Slack; !-commands arrive as /", async () => {
  account.push({ network: "slack", messageId: "slack:1730812345.001200", text: "/status", at: AT });
  assert.equal((await sentTo())[0].network, "slack");
});
test("/pause from Slack writes OFF by slack", async () => {});
// desk-conversation.test.ts
test("a Slack text's answer goes back to Slack, a Telegram text's to Telegram", async () => {
  /* two turns, records message {kind:"telegram", network:"slack", …} and {…, network:"telegram"} → outlet saw opts {kind:"chat", network:"slack"} then {kind:"chat", network:"telegram"} */
});
test("a cut-turn line goes as chat with no network", async () => {});
// desk-session.test.ts
test("the provenance line names the network; no network reads telegram", () => {});
// cycle.test.ts — the shipped desk.md names both forms and fits 3,000 bytes
// watchdog.test.ts
test("the account down with only Slack connected: one direct line through chat.postMessage, its tokens taken out", async () => {
  /* home with slack.json only → fetch saw https://slack.com/api/chat.postMessage, Authorization Bearer, form channel and text; ok:false answer is a failure; nothing more until back */
});
test("with both connected, the direct line goes on Telegram alone", async () => {});
```

- [ ] **Step 2: Run** each file with `cd face && npx tsx --test tests/<file>`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The Slack direct send checks the JSON body's `ok`, not only the HTTP status: Slack answers 200 to an `ok: false`.
  - It escapes `&`, `<` and `>`, and redacts both tokens and the Slack shapes.
  - `scripts/watchdog.ts`'s header names the Slack fallback.
- [ ] **Step 4: Run** the face suite, typecheck and `FACE_SMOKE=1 npm test`. Expected: green.
- [ ] **Step 5: Commit**: `feat(face): Slack beside Telegram - its token route proxied unparsed, Slack's ids on the wire, every phone answer back to its own network, and the watchdog's one line on Slack when Telegram is not connected`.

---

### Task 7: Account › Identity — Install app… in four sheets, and Slack's column

**Files:**
- Modify: `face/client/js/host/identity-view.js`, `host/identity.js`, `host/sheet-identity.js`, `render/identity.js`, `reducers/identity.js`
- Test: `face/tests/client/identity-view.test.js`, `identity-host.test.js`, `sheet-identity.test.js`; `face/tests/gravit-client-smoke.test.ts` (extend)

The client seams B1b made for Telegram:
- `identity-view.js`: `SPOKEN = ['telegram']`, and `identityOf`'s `slack: { state: 'soon' }` and grid `slack: { enabled: false }`.
- `render/identity.js`: `telegramRow` becomes `networkRow(net, row, state, owner)`, and the `slack` branch with its `Soon` chip goes.
- `host/identity.js`: `TOKEN_PATH`, `openConnect()` and `next(tokenInput)`.
- `sheet-identity.js`: `NETWORK_NAME` and `SPOKEN`.
- `CONNECT_STEPS`: by network.

**Interfaces:**
- Produces:
  - `identityOf(read)` reads `networks.slack` like `networks.telegram` (`connected` | `none`), and the grid's `slack` is `{ on, enabled: connected }`.
  - `identityOf(read).slackManifest`.
  - `TOKEN_PATHS = { telegram: '/data/account/identity/telegram/token', slack: '/data/account/identity/slack/token' }`.
  - `openConnect(network = 'telegram')`.
  - `next(first: HTMLInputElement, second?: HTMLInputElement)`. For Slack it hashes `app + '\u0000' + bot` with B1b's `fingerprintOf`, posts `{appToken, botToken, keyHash, salt}` once, and clears both fields.
  - `connectRoutingOf(read, 'slack')`.
  - `CONNECT_STEPS.slack = { 1: SLACK_STEPS_1, 2: SLACK_STEPS_2, 3: SLACK_STEPS_3 }`; `identityLinesOf('connectNetwork', seed)` for Slack says `Tokens kept in` and `Network: Slack`.

- [ ] **Step 1: Write the failing tests.** Fixed copy is asserted word for word:

```js
const SLACK_STEPS_1 = [
  'Open api.slack.com/apps, choose Create New App, then From a manifest, and pick your workspace.',
  'Paste the manifest above and create the app.',
  'In Basic Information › App-Level Tokens, generate a token with the connections:write scope. It starts with xapp-. Paste it in the first field.',
  'In Install App, install the app to your workspace and copy the Bot User OAuth Token. It starts with xoxb-. Paste it in the second field.',
  'Paste them only here, never in a chat, not even with Gravit.',
];
const SLACK_STEPS_2 = [
  'Open the link or scan the code: Slack opens Gravit\'s app.',
  'In its Messages tab, send it any message, for example hi.',
  'Wait here: this sheet moves on when the app hears you.',
];
const SLACK_STEPS_3 = [
  'Check the name, the handle and the message: they should be yours, sent a moment ago.',
  'This is me: Gravit talks only with this Slack account, in this direct message.',
  'Not me: that sender is listed under Not you and never reaches Gravit. Say hi again from your own Slack account.',
];
const SLACK_STEPS_4_NOTE = 'On Slack, type the phone\'s commands with ! — !status, !pause 30m, !mute 30m, !new, !stop.';
test('Slack not connected: Not connected and Install app…; connected: Connected, Speaks as, Talks only with, Details and Disconnect…', () => {});
test('the grid enables Slack\'s column once Slack is connected; iMessage stays disabled', () => {});
test('sheet 1: Connect Slack · 1 of 4 · App tokens — the manifest with Copy, two password fields, no form, where they are kept, its steps above the keys', () => {
  /* a <pre> of the manifest from the read and a Copy key (navigator.clipboard.writeText); two input type=password autocomplete=off with B1b's ignore marks, labelled App-level token (xapp-…) and Bot token (xoxb-…); no <form> in the drawer; lines 'Kept in: Account · :4820', 'Never in: Gravit\'s box · ~/.dsh'; <ol> SLACK_STEPS_1 before the button row */
});
test('Next hashes the pair in the browser, posts it once, clears both fields, and keeps no token in the store', async () => {
  /* post spy: one call to /data/account/identity/slack/token; keyHash === sha256hex(hex2bytes(salt) + app + "\0" + bot); both inputs ''; JSON.stringify(store.get()) holds neither */
});
test('Next with one field empty posts nothing and says which is missing', async () => {});
test('sheet 2: Say hi with the app_redirect link, its QR, the workspace and the expiry; sheet 3 and Not me as Telegram\'s', async () => {});
test('This is me opens sheet 4 seeded for Slack, with Slack ticked in all five rows on top of the routing now', async () => {
  /* routing 'chat=slack,telegram;alerts=slack,telegram;brief=slack,telegram;cards=slack,telegram;fills=slack,telegram' when Telegram is ticked everywhere */
});
test('sheet 4 for Slack: its seven lines, B1b\'s steps, and the ! note', () => {
  assert.deepEqual(identityLinesOf('connectNetwork', SLACK_SEED), ['Network: Slack', 'Speaks as: @gravit', 'Talks only with: @pan',
    'May send: Chat with Gravit, Watch alerts, Pre-close brief, Cards waiting, Fills and reports', 'Tokens kept in: Account · :4820', 'Signed by: this browser', 'Until: you disconnect']);
});
test('Disconnect Slack drafts disconnectNetwork slack with Slack\'s words', () => {});
```

  Update B1b's pinned cases: Slack is no longer `soon`, and the row has no `Soon` chip. The client smoke draws a stand-in read with Slack connected.

- [ ] **Step 2: Run** `cd face && npx tsx --test tests/client/identity-view.test.js tests/client/identity-host.test.js tests/client/sheet-identity.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The button reads Install app… for Slack and Connect… for Telegram.
  - Sheet 4 draws `SLACK_STEPS_4_NOTE` under B1b's `CONNECT_STEPS_4` for Slack only.
  - The disconnect sheet's lines name Slack: `Gravit stops reading and sending on Slack.` and `Both tokens are deleted from the account.`
  - The manifest's Copy key falls back to selecting the `<pre>` when the clipboard is refused.
- [ ] **Step 4: Run** the face suite, typecheck and `FACE_SMOKE=1 npm test`. Expected: green.
- [ ] **Step 5: Commit**: `feat(client): Account › Identity connects Slack - Install app… in four sheets with the account's manifest and two tokens sent once, and Slack's column in what reaches you where`.

---

### Task 8: Charter, docs and the Slack phone drill

**Files:**
- Modify: `Gravit-Design.md`, `DEVELOPMENT.md`, `CLAUDE.md`, `face/README.md`, `account/README.md`, `Gravit-Docs-and-Prompt-Loops.html`

- [ ] **Step 1: The charter.** This is spec §5.9 as it applies to Slack, which was approved with the spec.
  - D20 names `credentials/networks/slack.json` (the app's two tokens) beside Telegram's file. Slack's connection is an outbound Socket Mode socket. The host watchdog may read Slack's bot token only when Telegram is not connected, and only to say the account is down.
  - §7.3's three sentences read "the account polls Telegram and holds Slack's outbound socket".
  - The §4 write map adds `identity/slack.cursor`.
  - D19 and the §8 row stand as written. They already name Slack as a new network, not a second user.
  - Add the revision line.
- [ ] **Step 2: `DEVELOPMENT.md`.**
  - §3.9 "Identity" gains the seams (`PendingSource`, `Transport`, `Connector`), Slack's files, routes and words, and rulings 1–13.
  - The §4.4 route table gains the Slack token route; the proxy has 44 routes.
  - §4.6 and Appendix A gain `ACCOUNT_SLACK_API`.
  - §5 covers the client's Slack sheets.
  - §7.3 lists the new tests.
  - §7.4 gains a manual B2 row.
  - §9 residuals: no threads; the 30-minute refresh is the only check for a half-open socket; Slack's rate limits on `conversations.history`; one workspace; Enterprise Grid untested.
- [ ] **Step 3: `CLAUDE.md`.** The `account/` row's identity mention names Slack (Socket Mode, its two tokens under `credentials/networks/`). The proxy's count becomes forty-four exact routes.
- [ ] **Step 4: `face/README.md`.** Add "The Slack phone drill" after "The phone drill", in the operator section's words below. The Identity paragraph loses `Soon`. The commands table notes the `!` form on Slack.
- [ ] **Step 5: `account/README.md`** gains the Slack routes, files and `ACCOUNT_SLACK_API`. **`Gravit-Docs-and-Prompt-Loops.html`** (Chinese) gets a dated line in 13.1 and the phone-loop paragraph: Slack through Socket Mode, the `!` commands, replies only to the DM, and `[slack · operator · …]`.
- [ ] **Step 6: Run** `cd face && npm test` (the doc-pinned tests) and `cd account && npm test`. Expected: green.
- [ ] **Step 7: Commit**: `docs: Slack in Account › Identity - D20, 7.3 and the write map as approved; DEVELOPMENT, CLAUDE.md, the READMEs, the loops page and the Slack phone drill`.

---

## For the operator, after the merge

These steps are yours. An agent never does them: they drive your launchd and your Slack workspace.

1. **Merge** `feat/identity-b2` into `main` when you are happy with the review. No `npm ci` is needed: no dependency changed.
2. **Restart** the account, then the face, as after B1. Hard-reload the page.
3. **The Slack phone drill** (`face/README.md`):
   1. **Install app…** on a page that signs. Sheet 1: copy the manifest, then create the app at api.slack.com/apps from it, in a workspace where you are the only person, or one whose owners you trust with what you and Gravit write there. Make the `xapp-` token with `connections:write`, install the app, and paste both tokens. PASS: both fields are empty at once, and the browser offers to save nothing. Sheet 2: open the link and DM the app `hi`. PASS: sheet 3 shows you. Check that it is you, then read and sign sheet 4.
   2. **The tab.** PASS: Slack Connected, Speaks as `@gravit`, Talks only with `@you`; Slack's column is enabled and ticked; iMessage is Later.
   3. **Status and chat.** In the DM send `!status`. PASS: a `phone: … slack polling …` line. Ask Gravit something. PASS: the answer arrives in the DM, top level.
   4. **Both networks.** With Telegram connected too, ask on Telegram. PASS: the answer comes on Telegram, not on Slack. An alert arrives on both.
   5. **A stranger.** Another member of the workspace DMs the app. PASS: nothing answers, and Not you shows `Slack · …<three characters> · 1`. Block it.
   6. **No formatting, no link.** Ask Gravit to repeat `<!here> *x* a & b`. PASS: it arrives literally, with no mention and no bold.
   7. **The account down.** Stop the account, write `are you there` in the DM, and start the account again within a few minutes. PASS: the desk answers it once. If Telegram is not connected, after ten minutes the watchdog's account-down line arrives on Slack.
   8. **Pause and mute.** `!pause 30m` and `!mute 30m` answer. Resume from a terminal.
   9. **Disconnect… Slack** and sign. PASS: the app stops answering; `credentials/networks/slack.json` is gone (`ls`, never `cat`). To retire the app, delete it at api.slack.com/apps, which revokes both tokens.
4. **Record** the date, the commit and the Slack clients (desktop and phone) in `DEVELOPMENT.md` §7.4's manual B2 row.

## Left for later

- Threads: answering inside the operator's thread. This needs a map from `ts` to thread root in the account.
- Slack slash commands (a `/gravit status` registered on the app, sent as Socket Mode `slash_commands` envelopes), and Block Kit buttons. Buttons are a charter §8 trigger.
- Token rotation (`xoxe-` refresh tokens), multiple workspaces, and Enterprise Grid's org-wide user ids.
- A liveness check for a half-open socket finer than the 30-minute refresh.
- Images and files from the operator. Today they get `text only, please`.

## Open for the operator

1. **Which workspace.** A Slack workspace's owners can export DMs on some plans. The plan assumes a workspace where you are the only member, or one whose owners you trust. Is that the rule, and should the sheet say so?
2. **The `!` commands** (ruling 5). Is typing `!status` on Slack acceptable, or do you want a registered `/gravit` slash command later?
3. **The app's name.** The manifest names the app and its bot user `Gravit`. Change it if your workspace has another Gravit.
4. **The watchdog on Slack** (ruling 13, D20's wording). Should it read Slack's bot token when Telegram is not connected, or say nothing on Slack at all?

## Self-Review

- **Spec coverage.**
  - §5.7's four sheets, the manifest and the DM only: Tasks 3, 4 and 7.
  - §5.3's token trip, fingerprint and storage: rulings, Tasks 1 and 3.
  - §5.4's Socket Mode: Tasks 2 and 4.
  - §5.5 inbound with nothing lost (ack after append, the backfill), and outbound with the account picking: Tasks 4 and 5; reply context through `replyTo`: Task 4.
  - §5.6's kinds, quiet hours, notices and no links on Slack: Task 5; a reply to its own network: Task 6.
  - §5.9: Task 8. §5.10's watchdog: Task 6.
  - §8's scopes and formatting: rulings 4 and 6.
- **Types.** `Network`, `WIRE_ID`, `slack:<ts>`, the Slack `botId`/`operatorId` form and `SlackSecret` match across the account (Tasks 1–5), the face (Task 6, `WIRE_ID` redeclared in `phone.ts`) and the client (Task 7, the seeds).
- **Review Focus.** Each item has a named test in its owning task.
