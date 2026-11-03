# Account split and Identity: design

**Date:** 2026-11-03.

**Status:** draft for the operator's approval. Nothing is built.

**Canvas:** https://claude.ai/artifact/EpipjwanT5xSCrDw4heEXJ (private). It has three boards: ① the split, ② Account › Identity and the phone, ③ Connect Telegram.

**Read with:**
- `Gravit-Design.md`: D10, D17, D18, D19, D20, the §4 write map, §7.3 and the §8 triggers.
- `docs/superpowers/specs/2026-11-01-account-two-parts-design.md`: the two parts as they run today, in one process.
- `docs/superpowers/specs/2026-10-19-always-on-gravit-design.md`: the desk and its Telegram bridge.

## 1. Intent

On 2026-11-03 the operator chose not to hand-edit `$DSH_HOME/.env` to give the desk its Telegram token, and asked for this instead:

> 要不这样，换一种方式，你把account的market和钱包拆成2个端口/docker，拆完之后，在account里面，portfolio/money/venues/agents/cards/rules那一栏最后面加一个'身份'栏，这一栏用来接入imessage/telegram/slack这些

In English: split the Account's market and wallet into two ports or two docker boxes; then add an Identity (身份) tab after Portfolio, Money, Venues, Agents, Cards and Rules, for connecting iMessage, Telegram, Slack and the like.

These are two projects, built in the operator's order:

- **Part A: the split.** Today the Account's Market part and its wallet part run as one process on 127.0.0.1:4820. They become two services on two ports, and two boxes under compose.
- **Part B: Identity.** A seventh tab on the face's Account page, after Rules. There the operator connects Gravit to Telegram first, then Slack. For now iMessage only holds its place on the tab (§10, Q3). The connections run in the wallet service, and their tokens are stored there.

The operator made two corrections on the canvas, and this document carries both:
- The Identity tab has one Gravit card. There is no separate "You" card.
- Each Connect sheet ends with written instructions.

After those corrections the operator called the canvas reasonable ("合理了"), and then answered the three questions in §10.

**Why.** The operator said what to build. Asked how deep to cut, they chose the full cut (§10, Q1), which follows from the first reason below. The other two reasons are my reading:
- "Account" names the wallet half only, and the data interfaces belong to the Market (operator, 2026-11-01). Today the Market's reads still answer under `/api/account/*`, from the wallet's process.
- The Market part runs third-party code and talks to many hosts: the akshare-mcp Python child, Tencent, the Lunhui relay's sources, and iFinD. After the split, none of that shares a process or a box with a money key, and a failing source can restart without taking the wallet down.
- A chat-network token is a key. Keys live in the Account and never in Gravit's box (`$DSH_HOME`, the agent box).

**What success looks like:**
- `npm run market` (port 4821) and `npm run account` (port 4820) start two processes.
- `docker compose up` starts three boxes (agent, market, account) and still publishes only 127.0.0.1:3090.
- On paper venues, the Markets, Trade and Account screens look and behave as they do today.
- The operator connects Telegram from Account › Identity with four sheets and one signature, and edits no file by hand. From then on they receive the pre-close brief, watch alerts and card notices on the phone, and can talk to Gravit there.
- No network token is stored in `$DSH_HOME` or the agent box.
- A stranger who finds Gravit's bot never reaches Gravit.

## 2. Non-goals and anti-goals

**Non-goals:**
- No new data source, venue, order type or card.
- No public address. Every connection is outbound: the account polls Telegram and holds Slack's socket. Nothing listens, so charter §7.3 stands.
- No approval from the phone. A waiting card is announced on the phone and answered in the browser (D18, §8). The operator chose this (§10, Q2).
- No second person and no group. On every network Gravit talks with the operator only, so the §8 trigger stands.
- No buttons on the phone in this round.

**Anti-goals.** Each of these counts as failure even if everything else works:
- A network token or a money key stored in the agent box or under `$DSH_HOME`.
- A text from anyone but the operator reaching Gravit.
- The wallet refusing to show holdings because the Market is down.
- A paper order filling on a stale price because the Market is down.
- The split changing what the operator sees on paper venues.

## 3. Constraints

- **Runtime and packages.** Node 22. Each service is its own package with its own `npm ci`.
- **No Python in the repo.** The akshare-mcp child is installed by uv in the box that runs it, as `account/Dockerfile` does today.
- **Copy and look.** Product copy is English and uses the face's tokens: cream `#f6f4ef`, Manrope, the seg tabs, cardboxes and `.btn-sm`. Planning notes and canvas annotations may be Chinese; nothing on screen is.
- **Owner signing (D18).** Every owner write is signed by the page's owner key: prepare, then What you sign, then sign, then `POST /api/exchange`. The face holds no key and signs nothing.
- **Gate 2.** Every seat write gets a card. Reads never do.
- **Listening and fences.** Every service binds 127.0.0.1 by default and keeps the Host/Origin fence and the NO_PAGE answer (`account/src/portfolio/server.ts`). Under compose, a service widens its listener and Host fence for the compose network only, the way `PORTFOLIO_BIND` and `PORTFOLIO_HOSTS` do today.
- **Licence.** `account/` is Apache-2.0 code from Linqi's buyer-agent-demo @ 133b9a7. Code moved out of it keeps its headers, and the new package carries the same `NOTICE` and `LICENSE`.
- **Paper venues only**, as CLAUDE.md's gotchas say.
- **Size budgets.** `GRAVIT.md` stays at or under 4,500 bytes, and `dsh/profile/lunhui-run.md` at or under 3,000 bytes (it is at 2,999). Any renamed tool they mention must still fit.

## 4. Part A: the split

### 4.1 Three processes, three boxes

| Service | Port | Compose box | Holds |
|---|---|---|---|
| face | 3090 | `agent`, which publishes 127.0.0.1:3090 | dsh, Gravit, the desk and the client. Its only key is the DeepSeek key. |
| market (new) | 4821 | `market`, which exposes 4821 | Keyless public data, plus the data vendor's token (iFinD). No money key, no ledger, no home directory. |
| account | 4820 | `account`, which exposes 4820 and mounts the `account-home` volume | The wallet: owner devices, venues and their keys, ledgers, paper venues, orders, seats and their limits, cards, Guard, rules and the watch list. After Part B it also holds the network connections. |

Port 4821 is used today by the face smokes' Account stand-in (`account/test/standin/ui-standin.ts`). The stand-in moves to an ephemeral port, so a running market service can never collide with a smoke. (My call.)

### 4.2 The seam

Today the Market and the wallet share one Express app (`startPortfolioServer`) and one `PortfolioService`, with no router or prefix between them. The Market's reads answer under `/api/account/*`.

The natural seams already exist as injected options and keyless modules: `opts.cn` (the relay and iFinD), `opts.akshare`, `opts.china` (`live/china.ts`), `live/public-markets.ts`, `live/prices.ts` and `live/stream-hub.ts`. None of them holds a key or a home directory.

**What moves to the market service:**
- The public sources and their prices.
- The public stream hub.
- China (Tencent).
- The AKShare sidecar and its child process.
- The Lunhui relay and iFinD.
- The reads built only on those:
  - explore over public markets, and search;
  - quotes, China included;
  - candles, book and trades from public sources;
  - the market stream: quote, book and trades events, and follows;
  - `/api/cn/relay`, `/api/cn/ifind`, `/api/akshare/tools` and `/api/akshare/call`.

The market's routes no longer say "account" (for example `/api/explore`, `/api/quotes`, `/api/stream`); the builder picks the exact names. The market writes nothing to disk. Its caches live in memory, as the Market part's do today.

**What stays in the account** is everything that needs a key or keeps state:
- Pairing and owner devices.
- Venues, and connecting them.
- A connected venue's own data: its markets, compare, and its keyed book, trades and candles, read through its trader.
- Holdings, positions, statement, history, funding, receive, earn and sellable.
- Valuation and the net-worth snapshot.
- Paper venues.
- Prepare, and the exchange door.
- Agents, seats and limits, and the agents' desk and memory.
- Cards, Guard and rules.
- The watch list, which is an owner-signed `setWatch`.
- The legacy and simulated routes.
- The OAuth callback.
- Its own push channel for wallet events: order, fill, position, balance, paper, statement, card and desk.

### 4.3 The couplings, and how each one is cut

Every coupling below is an in-process call today.

1. **Valuation, the net-worth snapshot, prepare and agent wallets.** The `price` dependency (`liveDeps().price`), `holdings`/`dayStats`, the snapshot timer and `account.prepare` read prices from the market service over HTTP, through one market client in the account with a short cache. If the market is unreachable, the account keeps answering: a value shows its last price and says that it is old, and a prepare that needs a price refuses with a plain sentence. (My call.)
2. **Paper venues.** `paperSource` takes its prices and its feed from the market client and the market stream, instead of from `publicMarkets()` and the in-process hub. While the market is unreachable, resting paper orders wait, and nothing fills on a stale price. (My call.)
3. **Keyed data before public data.** Today candles, book, trades, explore and quotes ask a connected venue's trader before the public sources. That order stays.
   - A connected venue's own candles, book and trades stay with the account, read through its trader.
   - The client asks the account first when a market is traded on a connected keyed venue, and the market service otherwise. If the account is down, the screens fall back to the public data.
   - This matters on paper too. Besides the local paper books, `live/index.ts` defines two keyed paper venues: `alpaca-paper` (Alpaca's own paper account) and `hyperliquid-paper` (Hyperliquid's testnet, whose book is not mainnet's). Showing them public data would break the anti-goal in §2.
   - The local paper books fill at the public prices, so for them the account has nothing to add.

   (My call, after the builder check.)
4. **One read cache.** Each service keeps its own cache. The venue health shown on the Venues tab stays with the account.
5. **One push channel.** It becomes two:
   - the market stream: quote, book and trades, with follows keyed to that stream's client;
   - the account stream: the wallet events.

   The face relays both, and the client follows both.
6. **Explore's venue filter.** The market's explore returns public markets. The client joins them with the account's `venues` and `connect/reach`, which it already reads, to show where each market can be traded. The join moves to the client, in `host/markets.js`. (My call.)
7. **Asset.** Today the asset answer mixes holdings, compare, candles and statement. The client builds the asset page from the account's parts and the market's candles. (My call.)
8. **The agents' desk world.** The `explore` and `liveMarket` functions it is handed in `service.ts` go through the market client.
9. **The watch list** stays the account's owner-signed state. The market does not know it.

### 4.4 Gravit's tools

- **A new `mcp-market` row.** It is the market package's own stdio MCP server, spawned the same way as the seat's. It carries the read tools that move: explore, quotes, candles, book and trades, and akshare. It needs no key, and reads never get a card.
- **`mcp-account`, the seat,** keeps the wallet's reads and writes. Gate 2 does not change.
- **Renamed tools change everywhere in the same plan:**
  - `GRAVIT.md`;
  - `dsh/skills/mechanics` (account-seat-guide);
  - `dsh/profile/cycle.md`;
  - `dsh/profile/lunhui-run.md` and `lunhui-module.md`;
  - every `roles/*/role.yml` allow-list;
  - every bot's allow-list;
  - the Lunhui plugin.

This is the canvas's sticky s2.

### 4.5 The face

- **Two upstreams.** `FACE_ACCOUNT_URL` (default http://127.0.0.1:4820) and `FACE_MARKET_URL` (default http://127.0.0.1:4821).
- **The proxy** (`face/src/account-proxy.ts`). Market reads and the market stream go to the market service, under their own `/data/market/…` paths. Everything else goes to the account.
- **Rows.** The account half of the proxy follows the `mcp-account` row and the market half follows the `mcp-market` row. Today a single row switches the whole proxy off. (My call.)
- **The desk's prices** (`face/src/market-quotes.ts`) and the Lunhui plugin's `account-fetch.mjs` (relay and iFinD) point at the market.
- **The client.**
  - `host/markets.js` and `host/trade.js` read the market paths.
  - `wire/account-stream.js` gains a twin for the market stream.
  - The joins from §4.3 items 3, 6 and 7 live in the host layer: the keyed-first read, explore's venue filter, and the asset page.
- **`face/tests/no-market-hosts.test.ts`** keeps checking that the face never calls a market host itself.

### 4.6 Packaging

- **A new top-level `market/` package** (`gravit-market`, Node 22, `npm ci` inside it):
  - scripts `market` (127.0.0.1:4821), `market:mcp`, `test` and `typecheck`;
  - a `market:service` script that installs the market as a LaunchAgent, like `account:service` (§5.10);
  - a `Dockerfile` that installs uv and akshare-mcp;
  - `MARKET_BIND` and `MARKET_HOSTS`, mirroring the account's variables.
- **`account/` keeps the wallet.** It no longer spawns AKShare, holds the iFinD token, or calls a public data host. A test checks this, like the face's test.
- **`compose.yml` has three boxes.**
  - `market` gets `.env.ifind`; `account` no longer does.
  - Health checks: the market's own, and the account's `/api/overview`.
  - The `agent` box gets both URLs.
- **Docs.**
  - CLAUDE.md's map gains `market/`.
  - `DEVELOPMENT.md` is updated.
  - `face/README.md`'s two-box drill and two-parts drills are rewritten for three boxes.

### 4.7 Order of work

Each plan leaves `main` working.

- **A1.** Build the market package and service, with `market:service`. The account uses the market client (§4.3 items 1, 2 and 8). The account keeps answering its old Market routes by relaying them to the market, so the face does not change yet.
- **A2.** Then:
  - the face and client move to two upstreams (§4.3 items 3, 5, 6 and 7; §4.5);
  - `mcp-market` and the tool renames land (§4.4);
  - the account drops its relays;
  - compose, the docs and the drills are updated.

## 5. Part B: Identity

### 5.1 What the operator sees

The Account tabs become Portfolio · Money · Venues · Agents · Cards · Rules · **Identity** (canvas ②). The Identity tab has three cards.

**Gravit.** One row per network: Telegram, Slack and iMessage.
- **A connected row** shows:
  - the network;
  - its state: Connected, or On this Mac for iMessage;
  - "Speaks as": Gravit's handle on that network, for example `@gravit_desk_bot`;
  - "Talks only with": the operator's handle on that network;
  - the buttons Details and Disconnect….
- **A row that is not connected** shows "Not connected" and the button Connect….
- The operator's own handle is not a card of its own (the operator's correction). Every connected row must carry it instead, because a bot is public and anyone who finds it can write to it.
- **iMessage's row is a placeholder for now** (§10, Q3). It shows the network's icon and name and a muted "Later" chip, with no button.

**What reaches you where.** A grid:
- Rows: Chat with Gravit, Watch alerts, Pre-close brief, Cards waiting, Fills and reports.
- Columns: Face (always on), Telegram, iMessage and Slack. A network's column is disabled until that network is connected. iMessage's column stays disabled while it is a placeholder.
- Below the grid: Quiet hours, with Change….

**Not you · n.** The senders who wrote to Gravit and are not the operator. Each row shows the network, a masked id, a message count, the last time they wrote, and a Block button.

The owner buttons (Connect…, Disconnect…, saving the routing, and Block) appear only while the page signs, like every owner button on the Account page.

### 5.2 Connect Telegram: four sheets

As on canvas ③. Each sheet ends with numbered instructions above its buttons (the operator's correction).

1. **Bot token.**
   - A password field, with Paste and Next.
   - The sheet shows where the token is kept ("Account · :4820") and where it never goes ("Gravit's box · ~/.dsh").
   - The instructions say how to get a token from @BotFather: send /newbot, pick a name, then a username ending in "bot". They also say to paste the token only here, never into a chat, not even a chat with Gravit.
   - Next hands the token to the account. The account checks it with Telegram (`getMe`) and keeps it in memory as a pending connection.
2. **Say hi.**
   - The bot's link (t.me/<username>) and a QR code.
   - Pressing Start in Telegram sends `/start`. The account long-polls for that first message, and the sheet moves on when it arrives.
3. **Is this you?**
   - Shows the sender's name, handle, numeric id (masked) and message.
   - "This is me" binds that sender as the operator's handle on this network.
   - "Not me" adds that sender to Not you and returns to Say hi.
4. **What you sign.**
   - Lists the network, the handle Gravit speaks as, the operator's handle it talks only with, what Gravit may send (from the routing), where the token is kept (Account · :4820), who signs (this browser) and until when (until you disconnect).
   - Sign is an owner-signed write. Only after it does the account store the token and the binding and start delivering messages.

Closing a sheet before Sign drops the pending token. A pending connection also expires after a few minutes; the builder picks how many.

### 5.3 How the token travels, and where it is stored

The pattern is `setBrainKey` (`account/src/portfolio/account/brain-keys.ts`):
1. The owner signs the token's fingerprint, `sha256(salt‖token)`. The token itself is never signed.
2. The token travels once, beside the signed envelope, on its own route. That route has its own body reader and is skipped by the JSON parser.
3. The account stages the token in memory while the door checks the signature.
4. The account writes the token under `<home>/credentials/networks/`: mode 0600 in a 0700 folder, symlinks refused, through a temporary file, then fsync and rename.
5. The ledger keeps only the fingerprint.

This is the first secret to pass through the face's proxy:
- Venue keys are files the owner writes by hand, and the `brain-key` route is not proxied.
- The new route forwards the body unparsed and unlogged, as the proxy does with every body. The face never stores it.
- Under compose, the page reaches the account only through the agent box. A token pasted on the page therefore has to pass through that box.

The charter changes to say so (§5.9). (My call, following the flow the operator approved on the canvas.)

### 5.4 Where the connections run

**In the account service:**
- Telegram: a long poll on the Bot API (`getUpdates`), moved out of `face/src/telegram.ts`.
- Slack: Socket Mode, an outbound WebSocket that needs no public address.
- iMessage: through a helper program on the Mac (§5.8).

**In the face:** the face's own bridge loses its transport. The face has no token, no `getUpdates` and no `sendMessage`. The desk's side of the bridge stays:
- the commands `/status`, `/pause`, `/mute`, `/new` and `/stop` (the phone may only pause or mute, D19);
- posting a message into the conversation, with its dedupe key;
- the slow-turn lines;
- the carry of queued and claimed texts across a graceful stop;
- the outlet.

### 5.5 The desk and the account

Nothing new listens anywhere. The account polls the networks, and the face polls the account.

**Inbound.**
- The account keeps an inbox: an append-only ring of the operator's messages. Each message has an id that only grows and carries its network, the network's own message id, its reply-to id and its text.
- The face's bridge long-polls (`GET`) the inbox for messages after its own cursor.
- It posts each message into the desk conversation with the key `<network>:<message id>`. Today that key is `telegram:<update_id>`.
- It moves its cursor only after the post is flushed. The cursor lives in `$DSH_HOME/face/desk/`, where `telegram.offset` lives today.
- No message from the operator is lost between the network and the desk. The account stores a message before it advances the network's offset, and the face advances its cursor only after the desk has the message.
- Reading the inbox changes nothing in the account, so a shell turn that reads it cannot hide a message from the desk.
- The account never stores a stranger's text. For each stranger it keeps only a count and the last time.

**Outbound.**
- The desk's outlet (`DeskOutlet.send(text, {replyTo})`) becomes a `POST` to the account. The request carries the kind (chat, alert, urgent alert, brief, report, card or watchdog), the text, and the reply-to id.
- The account answers `{sent: ids}` or `{queued}`, as the outlet does today.
- The account chooses the recipients, not the caller. It sends only to the operator's bound handles, and only on the networks the routing allows for that kind.
- The account owns the outbox, the retries and the "late" line that `telegram.ts` owns today.
- It removes its own tokens from every text it sends, in addition to the face's redactor.

**Replies keep their context.** `watch.contextFor(messageId)` maps a reply on the phone back to the alert it answers. The account returns the network's message ids for what it sent and passes reply-to ids through, so the mapping keeps working. Message ids carry their network as a prefix.

**Auth.** These routes are unsigned and sit behind the account's fence, like its reads today. The face holds no key, and a shell turn can already reach loopback (D10, D17). The routes are safe because the account, not the caller, decides who receives each message. (My call.)

### 5.6 Who sends what, and when

| Kind | Who sends it | Today | After |
|---|---|---|---|
| Chat with Gravit (a reply to the operator's text) | the desk | goes to the phone | goes back to the network the text came from |
| Watch alerts | the desk's watch | go to the phone, unless muted | go to each ticked network; the desk's mute still holds them back |
| Pre-close brief, a strategy's report | standing orders | go to the phone | go to each ticked network |
| Cards waiting | Gate 2 (`orders.ts`, in the face) and the account's Guard cards | shown in the browser only | see below |
| Fills | the account | shown in the browser only | the account sends its own fill notices, with no desk turn |
| Watchdog | `face/scripts/watchdog.ts` | phones directly, with the token from `$DSH_HOME/.env` | asks the account to send; if the account itself is down, see §5.10 |

**Cards waiting, after.**
- A notice goes to each ticked network, for example: "Your call · Buy 10 NVDA · limit 183.00 · Paper · Alpaca — waiting in Gravit".
- The notice has no button and no link.
- Approval stays in the browser.

**No links to the face.** Nothing sent to the phone links to the face, not even the brief. The face listens only on 127.0.0.1, so such a link cannot open on the phone.

**Quiet hours.**
- Default 23:00–07:00 ET, the operator's time zone.
- During quiet hours the account holds back every kind Gravit sends on its own initiative, except urgent watch alerts (the rules marked urgent in `desk/rules.yml`) and watchdog notices.
- A reply to the operator's own text always goes.
- A message held back is not sent later; it is still in the face. (My call.)

**Several networks.** There is still one desk conversation. A reply goes back to the network the question came from. A kind Gravit sends on its own initiative goes to every network ticked for it. (My call.)

**The desk's pause and mute.** They cover what the desk sends. The account's own notices (fills, Guard cards) follow only the routing and quiet hours. (My call.)

**Saving.** Each of these is one owner-signed write:
- the routing and quiet hours (Save…, then What you sign);
- Disconnect…;
- Block.

The canvas phone board draws it this way.

### 5.7 Slack

- **Install app…** opens the same four-sheet flow.
  1. The account gives the operator an app manifest (Socket Mode, a bot user, direct-message scopes) for creating the app in their workspace, and asks for the app's two tokens: the app-level token and the bot token.
  2. Say hi, in a direct message with the app.
  3. Is this you?
  4. What you sign.
- Gravit talks with the operator in that direct message only, never in a channel (§8: no group).

### 5.8 iMessage

- **It cannot run in a docker box.** It needs a helper program on the Mac. The helper:
  - reads `~/Library/Messages/chat.db`, which needs Full Disk Access;
  - sends through the Messages app by AppleScript;
  - talks to the account over loopback.
- **Under compose the helper cannot reach the account box,** which publishes no port. So iMessage works only in the daily mode, where the account runs on the host.
- **Gravit's own Apple ID.** For Gravit to have its own identity on iMessage, as the operator wants, Messages must be signed in to an Apple ID that belongs to Gravit. A macOS user can sign in to only one iMessage account at a time. If the operator's own Messages is signed in on this Mac, Gravit needs a second macOS user that stays logged in, or another Mac. This needs confirming on this Mac before building.
- **For now iMessage is only a placeholder on the tab** (§10, Q3). Building it is a later decision. The notes above record what that decision will need.

### 5.9 Charter changes Part B needs

The operator approves these charter changes together with this document.

- **D20.** The token is a key held by the account, under its home directory, not in `$DSH_HOME/.env`. Each network has one bound handle. Connections are outbound only, and tokens are redacted. The host watchdog may read the token only to report that the account is down (§5.10).
- **§4 write map.**
  - The account writes `credentials/networks/`, its inbox, its outbox and the Not-you counts.
  - The face writes its inbox cursor and keeps the desk's records.
- **§7.3.** Nothing listens, as before. Add three sentences:
  - The account polls the networks.
  - The face polls the account.
  - A pasted token passes through the agent box unparsed and unlogged, and is never stored there.
- **D19** applies on every network.
- **§8.** Slack and iMessage are new networks, not a second user. A group, or a second person, still triggers the next charter.
- **D18.** The face's route allow-list gains the identity routes.

### 5.10 Keeping it running

After B1 the account carries the phone, so in the daily mode it must be kept running just like the face.

- **Three LaunchAgents:**
  - the face and its watchdog (`npm run service`, as today);
  - the account (`npm run account:service`, which already exists);
  - the market (`npm run market:service`, new in A1).
- **Installing them is the operator's step.** CLAUDE.md's rule for `npm run service` applies to all three: an agent never drives the operator's launchd. Each plan that adds a LaunchAgent writes that step out for the operator.
- **The watchdog** checks the face, the account and the market. It phones through the account.
- **When the account itself is down** past the watchdog's threshold, the watchdog reads the Telegram token from the account's home and sends one notice that the account is down.
  - It sends nothing more until the account is back.
  - It never uses the token for anything else.
  - Why this is acceptable: in the daily mode everything runs as the operator's own macOS user, so this read reaches nothing a shell turn could not already reach. Under compose the watchdog does not run.

  (My call.)

## 6. Decided by the operator

- Split the Market and the wallet into two ports, or two docker boxes. Then add the Identity tab after Rules, for Telegram, Slack and iMessage (2026-11-03).
- One Gravit identity per network, with no separate "You" card (2026-11-03).
- Written instructions at the bottom of each Connect sheet (2026-11-03).
- The full cut for Part A; notices only on the phone; iMessage as an icon placeholder for now (2026-11-03, §10).
- After those corrections, the canvas as a whole is reasonable ("合理了"). That covers what it draws:
  - three boxes, with the market on :4821 and the account on :4820;
  - two tool rows;
  - the connectors and their tokens in the account;
  - the four Connect sheets;
  - the phone receiving notices.

## 7. My calls, for the operator to check

1. The Markets screens keep showing a connected venue's own data first, through the account, with the public data as the fallback. This also holds for the keyed paper venues (§4.3, item 3).
2. When the Market is down, values show their last price and say it is old; a prepare that needs a price refuses; paper orders wait (§4.3, items 1 and 2).
3. The client joins explore with the venues, and builds the asset page itself (§4.3, items 6 and 7).
4. Each half of the proxy follows its own tool row (§4.5).
5. A pasted token passes through the face's proxy unparsed and is never stored there (§5.3).
6. The identity routes are unsigned behind the fence. The account picks the recipients (§5.5).
7. Quiet hours hold back what Gravit sends on its own initiative, except urgent alerts and watchdog notices. Replies always go. Held messages are not sent later (§5.6).
8. A waiting card's notice has no button and no link (§5.6).
9. The account sends fill notices itself, and the desk's pause does not cover them (§5.6).
10. The watchdog phones through the account. It reads the token itself only to report that the account is down (§5.10).
11. In the daily mode, three LaunchAgents keep the face, the account and the market running. The operator installs them (§5.10).
12. The face smokes' stand-in moves off 4821 (§4.1).
13. iMessage's placeholder is a row with a "Later" chip and no button, and its column in the grid stays disabled (§5.1).
14. Nothing sent to the phone carries a link to the face, not even the brief (§5.6).

## 8. Left to the builder

- The exact route names on the market service.
- The market client's cache times.
- How long a pending connection lasts.
- The Slack manifest's scopes.
- The size of the inbox ring.
- How each network formats messages, and how a message that is not text is refused.
- How the client builds the asset page.
- The test layout, and how the 22 account test files that start a server get a market service or a stub of one.
- Whether the desk's existing carry over a graceful stop simplifies once the account keeps the inbox.
- How Telegram reply ids already recorded by the watch are carried into network-prefixed ids.

## 9. Order of work

Every plan leaves `main` working.

- **A1, then A2** (§4.7).
- **B1: Telegram through the account.** It covers:
  - in the account: the identity store, the owner types (connect, disconnect, routing, block), the token route, the Telegram connector, the inbox and send routes, quiet hours, and Not you;
  - in the face: the proxy routes, the bridge moved onto the account, the watchdog (checking all three services, §5.10), and card notices from `orders.ts`;
  - in the client: the Identity tab, the four sheets, the routing editor, and Not you;
  - the charter changes (§5.9), and the docs and drills.

  The face keeps its old Telegram path until B1 switches it over. B1 then removes the `TELEGRAM_*` lines from `$DSH_HOME/.env`. B1 may be split into an account-and-face plan and a client plan.
- **B2: Slack.**
- B1 draws iMessage's placeholder. Building iMessage is not planned (§10, Q3).

## 10. The operator's answers (2026-11-03)

- **Q1. How deep does the split go? The full cut,** as Part A describes:
  - the Market becomes its own service and box, with its own routes;
  - the face talks to two upstreams;
  - Gravit gets `mcp-market`.

  The other options were:
  - a thin cut, in which only the keyless third-party sources move and the account keeps answering every route by relaying to the market;
  - building Identity first, since Part B does not depend on Part A.

  The operator kept the full cut and the original order.
- **Q2. What can the phone do with a waiting card? Notify only.** The phone shows a notice, and the operator signs in the browser on the Mac. The other options were:
  - pairing the phone's browser as an owner device over a private network;
  - approving with a button in the chat, which is a charter §8 trigger.
- **Q3. iMessage? Only an icon placeholder for now** ("先只做一个图标占位"). The tab shows iMessage's row and its grid column, disabled, with no Connect. There is no helper, no Apple ID, and nothing in the account.
