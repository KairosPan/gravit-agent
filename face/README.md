# gravit-face — the chat-light face as an in-process dsh host

One Node 22 process. It boots the DeepSeek Harness — dsh `0.2.0-rc.2`, pinned in
`src/version.ts` — from the `face` profile (bundles: `@deepseek-ai/dsh-base`
only), composes its policy defaults below the operator's patch layer and its own
host rows on top of it, and serves the operator's client — Messages, Markets, Trade,
Discover and Account — at http://127.0.0.1:3090/, behind the tokenized sign-in URL it prints at
start. No build step — `tsx` runs the
TypeScript directly. Specs: `../docs/superpowers/specs/2026-08-30-face-chat-light-design.md`
and `../docs/superpowers/specs/2026-08-31-face-instruments-design.md` — dated
design history, written against dsh 0.1.1-rc.2; this file and
`../DEVELOPMENT.md` carry the mechanism as it stands.

## Deploy the product landing page to Vercel

Production: [evolving-alpha.vercel.app](https://evolving-alpha.vercel.app).
Project: `kairospans-projects/evo-alpha`.

The public site is Gravit's English product introduction page for investors
and partners, built from `face/landing/`. Its
product gallery contains three screenshots of the existing client, staged with
illustrative public data and English presentation labels. Images can be enlarged
or opened at full resolution; they are not live account or market views. The
local workbench in `face/client/` still runs with `npm start`.

Use `face/` as the Vercel project root. `vercel.json` runs the dependency-free
`node scripts/build-static.mjs` build and publishes `dist/`; locally, run
`npm run build`. The build and `.vercelignore` explicitly allow only the nine
public landing files: `index.html`, `styles.css`, `main.js`, `favicon.svg`,
`social-card.svg` (editable sharing artwork) and `social-card.png` (social
preview), plus `demo-research.webp`, `demo-market.webp` and `demo-account.webp`.
No API keys, backend, workbench files or runtime data are
published. The previous public `/market` and `/account` URLs permanently
redirect to the landing page's `/#product` section.

The three images were captured, at 1440 × 1080 with fictional data, from the
old client's channel page and its `/market` and `/account` pages. Those pages
left with stage 2 of route A, and the two capture helpers that served them went
with them (`scripts/serve-research-demo.mjs`, `scripts/capture-demo-assets.mjs`);
the images stay as they are until new ones are captured from the current client.

To deploy again after signing in with `vercel login`:

```bash
cd face
vercel link --yes --project evo-alpha --scope kairospans-projects
vercel deploy --prod --yes --scope kairospans-projects
```

## Run

```bash
cd face
npm install
npm run setup            # creates $DSH_HOME/profiles/face (never overwrites)
source ../.env.deepseek  # DEEPSEEK_API_KEY - see below
npm start                # prints http://127.0.0.1:3090/?token=…  (profile: face)
```

The face sources `.env.deepseek` only: it holds no iFinD token. The iFinD token (`.env.ifind`) is
the Account's, sourced by the Account's own start. An operator's untracked `.claude/launch.json`
therefore changes in two lines: the face line drops `[ ! -f ../.env.ifind ] || . ../.env.ifind;`,
and the account line becomes
`cd …/account || exit 1; set -a; [ ! -f ../.env.ifind ] || . ../.env.ifind; set +a; exec npm run account -- --read-only`.
The Account must be restarted from this tree: an older Account has no `/api/cn/relay`, and every
Lunhui freeze then refuses `UPSTREAM_INVALID`, naming the Account. The same file's `account` entry
carries `"url": "http://127.0.0.1:4820"`, which opens `/` — and since 2026-11-01 the Account serves
no page: `/` answers 404 with `NO_PAGE` (`account/src/portfolio/server.ts`, `The Account serves no
page: its owner's screens are Gravit's face (Markets, Trade, Account). …`). The Account's screens
are this face's; the entry's `url` is stale, and its `--read-only` refuses paper orders too. Both
are the operator's to change — the tree documents the file and never edits it.

No Alpaca key file is sourced any more: since 2026-10-24 nothing in the face reads one (the
Python package, its producers and the keyed quote providers left with stage 3 of the graft). An
operator's own `.claude/launch.json` (untracked) may still source `../.env.alpaca` in its start
command; that line is harmless and can go.

Open the URL `npm start` prints — the one carrying `?token=` — not the bare
address (see "Sign-in" below). A face that came up prints:

```
gravit-face: agent presets: drill-bear, drill-bull, gravit, news-scout (default gravit; bots under …/bots)
gravit-face: http://127.0.0.1:3090/?token=… (profile: face)
gravit-face: the ?token= is a per-process secret: it mints a 30-day cookie for this host:port; later visits to the plain URL work
gravit-face: rooms: dispatch registered; caps {…}
```

preceded by `gravit-face: order gate armed for …` when the Account seat's writes are
registered ("The Account seat" below). A bot the face could not declare
is reported on stderr (`gravit-face: bot "<id>" is not declared - <reason>`),
and the `agent presets` line then ends `; N bot(s) not declared, see above`.

Without the key the face still boots and serves: sessions list, the UI works,
and the first prompt fails with a missing-credential error from the LLM route.
`../.env.deepseek` is gitignored and not loaded automatically. Equivalently, put
`DEEPSEEK_API_KEY` in `$DSH_HOME/.env` — `bootFace` runs dsh's layered env load
before composing, so the harness home's `.env` reaches the tree too.

The model is whatever dsh-base's `agent-default-model` row says —
`deepseek-official/deepseek-flash` — unless the profile patch overrides that
row (upgrade decision D2; the row to add is in "The profile" below). Nothing
else moves it: the face reads no `$DSH_HOME/settings.yaml` (D1: it provides no
`profileContext`), and a client's `session/selectModel` "save as default"
persists nothing here, because dsh saves a default only through a config
editor this tree does not mount.

A session's project directory is the **workbench repo root**, not `face/`: the
entry `chdir`s there before booting (spec section 3.2), because dsh's
`SessionController` takes that default from `process.cwd()`
(`new SessionCommandController(ctx, this.agents, process.cwd())`) and offers
no config key. The sandbox resolves each session's workspace root from that
session's own `cwd`, falling back to the same directory — so for a session
created outside any channel, "outside the session workspace" below means
outside the whole repo.

| Env | Default | What |
|---|---|---|
| `FACE_PORT` | `3090` | webserver port. `0` asks the OS for a free one |
| `FACE_PROFILE` | `face` | profile directory name — honored by BOTH `npm run setup` and `npm start` |
| `FACE_DESK` | unset | `0` mounts none of the desk's rows — no ledger `boot` or `shutdown`, no sleep watch, no desk conversation, no Telegram bridge — for a second face beside the service, which runs on a scratch home ("Run as a service" below); `/data/desk/status` and the Pause route still answer, `desk.enabled: false`. Any other value, empty included, leaves the desk on |
| `FACE_DESK_MODEL` | `deepseek-official/deepseek-flash` | the desk session's model route, `provider/model`; one the tree does not serve falls back to the tree's default selection — Gravit's model — with one line ("The desk" below) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_ID` | — | the bot's token and the operator's numeric Telegram user id; with both set (and the desk on) the face runs the Telegram bridge, with either missing it runs none ("The desk" below). The token is a key: it lives in `$DSH_HOME/.env` |
| `FACE_PYTHON` | `python3` | the interpreter a standing order's `.py` script producer runs under, `-I`; none ships, and nothing else in the face needs Python — the desk's market clock is Node (`src/market-clock.ts`) |
| `DSH_HOME` | `~/.dsh` | the harness home: profiles, sessions, storages, credentials — the browser-session signing secret included |
| `DEEPSEEK_API_KEY` | — | resolved per request through the credential seam, then the environment |
| `DSH_TELEMETRY_DISABLED` | unset | the telemetry row is already off by the face's policy layer (D3); this switch matters only once an operator patch re-enables it, and then still wins — ANY non-empty value (`0` and `false` included) disables it again |
| `DSH_PERMISSION_MODE` | `workspace-write` | sandbox mode. `danger-full-access` also sets the approval policy to `never` — it DISARMS the Gate-2 surface below (the order gate then refuses orders rather than running them) |
| `HTTP_PROXY` / `HTTPS_PROXY` | — | not applied inside the face process — neither to its own quote, search and Account fetches nor to dsh's requests: the face does not install dsh 0.2.0's proxy policy (D10), matching 0.1.1, which had none. Tool subprocesses still inherit the variables |

`FACE_PORT` and `FACE_PROFILE` read an empty value as unset, not as a literal:
`FACE_PROFILE=""` would otherwise resolve to `$DSH_HOME/profiles` itself, and
`FACE_PORT=""` is `Number("") === 0` — a face whose URL silently moves on every
restart. `"0"` is a non-empty string, so deliberately asking for an OS-assigned
port still works.

Ctrl-C (SIGINT) leaves 130, SIGTERM leaves 0; both dispose the tree first. A
startup failure dsh reports itself — a required row that did not activate, such
as `webserver` on a port already in use (`… webserver (required) …
EADDRINUSE`) — prints dsh's grouped diagnostic and exits 1. Every refusal in
"What boot refuses" below reaches app-boot's `installFailLoud`, which prints it
labelled `gravit-face` and exits 1.

### Run as a service

`npm run service` (`scripts/service.ts`; the desk spec's P0,
`../docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` §5.2) runs the
face as a macOS user service: a LaunchAgent,
`~/Library/LaunchAgents/com.gravit.face.plist`, which launchd starts at login
and again after any exit but a clean one — a crash, a `kill -9`, a boot that
failed — at most once every 30 s. It needs no administrator. Its program is
`node --import <tsx's loader> face/src/main.ts` — node by its `PATH` location,
the loader from this checkout's `face/node_modules`, `face/` as the working
directory — and that is one process, the face itself: the pid `status` prints
is the face's, and the ledger's `boot` line carries it. It runs this checkout's
files, so `restart` picks up new code; `install` again rewrites the plist —
another port, home or node — and stops the installed job first.

**Install from the checkout the service should run** — the primary checkout,
once the work is merged there. The script finds the repo root from its own
location and reads the key files there, and a worktree has neither the keys
nor, before the merge, the merged code; `install` prints the `main.ts` it will
run (`runs: …`).

```bash
cd face
npm run service -- install     # write $DSH_HOME/.env if the home has none; run the face now and at every login
npm run service -- status      # the default: launchd's state and pid, uptime, the desk, its pause
                               # and Telegram bridge, how the last run ended, the sign-in URL
npm run service -- url         # the sign-in URL (?token=) from the face's log
npm run service -- logs        # the last 40 lines of face.log and face.err.log
npm run service -- stop        # launchd lets go of the job; the plist stays, so start or the next login brings it back
npm run service -- start       # run it again; a running job is left alone
npm run service -- restart     # stop it as stop does, then start it, with a new token (after an update)
npm run service -- uninstall   # stop it and remove the plist; the ledger and $DSH_HOME/.env stay
```

Every command takes `--port N` for a face not on 3090; without it the port is
the installed plist's, else 3090. `install`, `start` and `restart` refuse while
anything else answers on that port — a terminal `npm start`, say: a second
face there would fail to bind, exit 1, and be started again every 30 s. When a
face answers there that is not launchd's job, `status` says so in one line —
`the face answering on 3090 is pid N, not launchd's job (pid M): another face
holds the port` — so the uptime above it is that face's. `restart` stops a
running job as `stop` does, with launchd's `bootout` (SIGTERM, then launchd's
exit timeout), waits up to 10 s for the port to fall silent, and starts it as
`start` does. The commands that drive launchd refuse off macOS.

**First install on this Mac.** The checkout lives in `~/Desktop`, which macOS
protects per process, as it does `~/Documents` and `~/Downloads`. A terminal
`npm start` reads it under the terminal's permission; under launchd, node is
its own responsible process, so the service's first start may raise "node
would like to access files in your Desktop folder" — possibly at a login
nobody is watching — or fail with `EPERM`, which shows in `face.err.log` while
launchd retries every 30 s. Allow it, or grant node Desktop access in System
Settings → Privacy & Security → Files and Folders, or keep the checkout
outside `~/Desktop`, `~/Documents` and `~/Downloads`; `install` prints a
`privacy: …` line before `next:` when the checkout is inside one of them.
macOS 13 and later also posts "Background Items Added" for the new
LaunchAgent: leave its Login Items entry allowed — turned off, it stops the
job loading.

**Install from the shell you run the face from.** `install` freezes that
shell's `PATH` into the plist (less the `node_modules` folders npm puts first)
and runs the first `node` on it, which it prints with the home (`home: …`,
`node: …`). That `PATH` must find the same `node`; the desk needs no
Python (its market clock is Node), and a `python3` on it serves only a standing order's `.py`
script producer, should one ever be armed (none ships) — unless `FACE_PYTHON` in the home's
`.env` names another. The service runs profile
`face` on the shell's `DSH_HOME`, so `install` refuses a home with no
`profiles/face` — `no profile at …: run "cd face && npm run setup" with
DSH_HOME=… first` — rather than install a face that would exit 1 every 30 s.
A shell whose `DSH_HOME` differs from the one the installed plist names moves
the service there, and `install` says so (`moving the service's home from …
to …`).

**Terminal-only variables do not reach the service.** Its environment is the
plist's and what dsh reads from the home's `.env` at boot: `FACE_PYTHON`,
`FACE_PROFILE`, `FACE_AKSHARE_MCP_COMMAND`, `DSH_PERMISSION_MODE` and anything
else exported only in a terminal never reach it — a script producer would run `python3` from its
`PATH`, profile `face`, AKShare at `~/.local/bin/akshare-mcp` and the
`workspace-write` sandbox mode. A name the face reads after boot can live in
the home's `.env` instead, which dsh fills in at boot.

**Keys.** The plist's environment is `PATH`, `HOME` and `DSH_HOME`, plus
`FACE_PORT` for a port asked for (`--port`, kept by a reinstall) — never a key:
whatever a LaunchAgent's environment holds shows in `launchctl print`. The face
finds its keys in `$DSH_HOME/.env`, which dsh reads at every boot (dsh's
credential store may hold `DEEPSEEK_API_KEY` too). When the home has no `.env`,
`install` writes one, mode `0600`, from the repo root's `.env.deepseek`,
`.env.alpaca`, `.env.ifind` and `.env.telegram`, copying an allow-list only —
`DEEPSEEK_API_KEY`, `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`,
`APCA_API_BASE_URL`, `IFIND_ACCESS_TOKEN`, `IFIND_REFRESH_TOKEN`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_ID` and any `ALPHA_*`; when no key file
holds one of those names it writes nothing and says so (`wrote no …`). An
existing `.env` is never rewritten. Two of its lines to read:

- `not in …/.env: …` names the keys the service expects and the file lacks —
  an empty value counts as missing. The face boots without them and fails at
  the first prompt or quote that needs one; add them by hand.
- `not copied (…): …` names every other name the key files hold. dsh refuses a
  bootstrap-only name in the home's `.env` — `PATH`, `NODE_OPTIONS`, any
  `DSH_*` — and the boot fails, which under launchd is a restart every 30 s;
  and the retired `ALPACA_KIT_ENABLE_ORDERS` has no business in the home.

**The home `.env` is a copy.** `install` copies the key files once and never
rewrites `$DSH_HOME/.env`: a key rotated in `.env.alpaca` reaches the next
terminal `npm start`, which sources it, but not the service — update the
home's `.env` too, then `npm run service -- restart`. The lines are copied as
written and dsh does not evaluate them, so a value that depends on shell
evaluation (`$(…)`, `${…}`) arrives literally.

**Sign-in.** The token is new on every start, the service's restarts
included: `npm run service -- url` prints the last one in the face's log — the
current run's once it is up. While the face does not answer, `url` adds `(the
face is not answering yet; this may be the previous run's URL)`: a face still
booting, or one that never came up, has not printed its own. A browser
already signed in to that host:port keeps its 30-day cookie across restarts
("Sign-in" below).

**Logs and the ledger.** The face's stdout and stderr go to
`$DSH_HOME/face/service/face.log` and `face.err.log`, which nothing rotates;
the plist's `Umask 077` gives what the face creates, those logs included, no
group or other access. The desk's ledger, `$DSH_HOME/face/desk/events.jsonl`
(`src/desk.ts`), records each `boot`, each clean `shutdown` with its exit code
and each `asleep` gap — more than two minutes between two of the face's 30 s
timer ticks. `status` reads it back: a run that the next boot followed with no
`shutdown` between is `last run: lost` — a crash or a `kill -9`, which
launchd's restart would otherwise hide. When the face does not answer,
`status` adds one ledger line on how its last run ended. `stop` and `restart`
should end a run cleanly — launchd's `bootout` sends SIGTERM, and the face's
desk writes its `shutdown` before anything else is torn down; the desk
drill's steps 3 and 4 check it. With a desk turn under way that takes up to
about 7 s more: the desk cancels the turn and gives its agent 2 s to go idle,
so the cut turn is recorded, and what it is still opening — a phone text, a
`/new`, the boot's own resume — up to 5 s, so nothing lands after the
`shutdown`. The ledger also records each pause and
its lift, each desk conversation the face opens, each desk turn and each turn
it refused ("The desk" below).

**A second face uses a scratch home.** A face beside the service — a terminal
`npm start`, a drill face — runs on its own home and port with the desk off:
`DSH_HOME=<scratch> FACE_DESK=0 FACE_PORT=3091`, after `npm run setup` with
that `DSH_HOME`, as the desk drill's step 6 does. Two dsh processes on one
harness home are unexamined, so no second face runs on the service's home —
where the ledger, too, assumes one desk-enabled face (a second one's `boot`
would mark the service's run lost; its clock row waits out a firing the service
has under way - a `started` younger than its deadline and a minute - before it
would call it cut off). `FACE_DESK=0` mounts none of the desk's
rows, and its `/data/desk/status` still answers, `desk.enabled: false`; it
matters on any home, because the desk's Telegram bridge is the one poller a
bot token allows — a second one gets Telegram's 409, and both faces' bridges
record the conflict ("The desk" below) — and the watch the spec's P3 adds will
hold whatever stream its US quote source allows.

**Sleep:** on mains, `sudo pmset -c sleep 0`; the display may sleep; on battery
the Mac sleeps mid-turn (the 2026-10-13 measurement), and the ledger records
the gap as `asleep`.


## The page (client/)

`/` serves **gravit-ui**, the front end of the settled Demo v2 design
(`docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md`), mounted on the face
as its client by route A of `docs/superpowers/specs/2026-10-19-gravit-ui-on-face-design.md`:
vanilla ES modules under `client/js`, one sheet, no bundler, no back end of its own —
everything on screen is what dsh and the face's `/data` routes say (`DEVELOPMENT.md` §5).
All three of its stages are built:

- **host-fed**: Messages — the session list (every session the host lists, grouped by channel —
  "Channels" below — newest first, a room's members folded under it, subagent children left
  out, archived ones under a folded `Archived`), a conversation's real
  transcript (a live session followed with its pulses, a cold one paged and never activated),
  the composer (a prompt; a `/` line to `commands/execute`; an `@` in a channel through the
  room engine), New message (a title, Where — a channel, or `New channel…` — and the first
  words), Details (the title with Change words, Fork, Archive or Un-archive, Delete; Created,
  Where, Agent, Members, Children with Stop, Usage, Stop Gravit), the three gate
  cards (the order card, an approval, a question) answered through the mux, the one status
  line under the composer (not signed in, reconnecting, a host error, a command's word), and
  Settings (Cream · Black · System);
- **host-fed since stage 2**: Markets (`#/markets`) — the Account's markets by its tabs, the
  stars, a search, and a market's page with its candles and venues — and Account
  (`#/account/portfolio`, `venues`, `agents`, `cards`) — the Account's Portfolio, Venues, Agents
  and Cards and the Statement drawer — both read from the Account through the face's proxy
  since 2026-10-22 ("Markets and Account" and "The Account in the face" below), the A shares
  included since 2026-11-01. The old `/market` and `/account` pages are gone (404);
- **host-fed since stage 3**: a channel's page (`#/channel/<id>`: its status, thesis, an old
  strategy's backtests, journal, files, and its agent and bot rosters with their editors), Discover
  (`#/discover`, the inventory of what Gravit runs — "Discover" below), the row actions, no tool
  call drawn (not in the thread, not in a member's Trace), a conversation's subagent children
  ("Temporary subagents" below) and a room member's trace. There is no shop, no Mail and no
  Memory: what the demo drew with no back end left the tree;
- **since the graft's stage 2** (2026-10-24): Trade (`#/trade`) and the owner's keys on Markets
  and Account, live while this page signs for the Account as one of its owner devices ("The
  Account in the face" below).

What the browser keeps is three keys: `localStorage["gravit-ui.prefs"]` — the theme, the rail's
fold, the list groups you folded, the last conversation, what was seen — and the stars: the
Account's markets (the A shares among them, as `cn:<code>`) under `gravit.account.watch.v1`, and the
old face list under `gravit.market.watchlist.v1`, which only an older star still sits on; and, once it has paired with the Account, two more: its owner key in
IndexedDB (`gravit-face-owner`) and `gravit.owner.signedOut.v1` after a sign-out. Nothing else: a
reload rebuilds the page from the host. The demo's director (`d`), its scripted Gravit and its seed are gone with
the move; `tests/client/*.test.js` keep the renderers and the host layer honest on a fake DOM
and a fake host, and `gravit-client-smoke.test.ts` opens one real session over the real wire.
Client assets carry no cache headers: hard-reload after any edit under `client/`.

### Sign-in: the tokenized URL

dsh 0.2.0 puts `/api` and the `/api/remote.mux` WebSocket behind a browser
session, and the face's `/` is where that session starts (`src/static.ts`,
dsh's `connection.authorizeIndex`):

| Request | Answer |
|---|---|
| `GET /?token=<the printed token>` | `303 ./` plus `Set-Cookie: dsh-auth-<hash>=…` — `HttpOnly`, `SameSite=Strict`, `Path=/`, 30 days, and no `Secure` (loopback HTTP) |
| `GET /` with that cookie | the chat page |
| `GET /?token=…` again, already signed in | `303 ./` |
| `GET /` without the cookie | `401` |
| `/api/*` and the `/api/remote.mux` upgrade without the cookie | `401`; a forged `Host` gets `403` even WITH a valid cookie — the loopback fence runs first |

- The token is per process: 32 random bytes, new on every start, printed on
  stdout and stored nowhere.
- The cookie is per **authority**: `127.0.0.1:3090` and `localhost:3090` are
  two sign-ins, and another `FACE_PORT` is another.
- It survives restarts for its 30 days because its signing secret is
  persistent: the first boot on a harness home writes a
  `client-connection/browser-session` grant record into
  `$DSH_HOME/.credentials.yaml`, beside the API keys. Removing that record and
  restarting mints a new secret, which signs every browser out.
- A tab whose cookie expired reads `not signed in - open the URL gravit-face
  printed when it started (…/?token=…)` on its status line.
- `/client/*` stays public files, and every `/data/*` route keeps only its own
  loopback Host/Origin fence (`isTrustedDataRequest`, `src/http.ts`) — no cookie,
  exactly as at 0.1.1 (upgrade decision D8). The page itself, at `/`, needs the
  sign-in; the old `/market` and `/account` pages, which did not, are gone.

### What boot refuses

dsh 0.2.0's own boot fails only when one of its required rows (in this tree:
`agent-loop`, `webserver`, `connection`) does not activate, and merely warns
about every other row. The face keeps 0.1.1's stricter contract: `bootFace`
(`src/boot.ts`) disposes the tree, never opens the browser streams, and throws,
naming the cause, when:

- the profile skipped a bundle (dsh-base failed to load);
- any enabled row is not ACTIVE once boot resolves — the strict row audit lists
  each as `id (package): state`: a pending row with the services it waits for,
  a failed row with its error, a throwing `disabled:` expression as a failure.
  A row naming a package the tree cannot import is refused here, where dsh
  itself would only have warned;
- a service the gates and rooms route through is missing — `approval`,
  `userQuestions`, `typertGateway`, `permissionPresets` — each refusal naming
  what its absence would silently cost;
- no ACTIVE `@deepseek-ai/dsh-api-remotes` row exists: the approval answerer.
  Without it the tree boots clean and passes every other check, and then every
  order is denied `no approval channel is available` and every question is
  refused `NO_PROVIDER`, with no card anywhere;
- `ask_user_question` is not in the live tool registry;
- a server carries the Account seat's tools and the order gate covers none of its
  writes (the Account renamed them under a server name of the operator's), or any
  server registers a retired order tool, `place_order` or `cancel_order` — a
  harness home still mounting the Alpaca MCP row of before 2026-10-24 does not
  boot until that row is removed (its server cannot start anyway: the Python
  package it ran is gone);
- the preset registry is missing, its default is not `gravit`, its roster
  cannot be read, the default preset is absent or broken (a role row that
  cannot mount lists it broken), or a bot the face declared is not listed;
- the legacy preset `kairos` (Gravit's id before 2026-10-08) is absent or
  broken — sessions created before the rename would not open;
- `../dsh/profile/persona.md` is not a valid strict template,
  `../dsh/profile/cycle.md` is missing, unreadable, empty or over 3,300 bytes
  ("The profile" below), or `../roles/` is missing or holds a role the face
  cannot read ("Roles" below) — all caught at compose time, before anything
  mounts; a role's or the cycle's message opens with the absolute path of the
  file or directory at fault, the persona's with `gravit-face: ` and then the
  path (`src/persona.ts`).

`main.ts` adds two: the `connection` service must exist (it is what mints the
cookie), and the browser streams open only once every face route is mounted —
it boots with `deferReady` and calls `commitReady()` last, which refuses a tree
that stopped in the meantime. A tab still holding its cookie reconnects the
moment the gateway admits it, so it must never find `/data` half-mounted.

## AKShare — through the Account

The face mounts no AKShare and runs no AKShare process. AKShare is the Account's
sidecar (`../account/README.md` "AKShare, the sidecar": the install and its pin, the
routes `/api/akshare/*`, the limits); Gravit reaches it through the seat's one read
tool, `mcp__account__portfolio_akshare` (`src/account-seat.ts`), which takes
`{tool, arguments}`. Use `akshare_discover` first; the Tencent A-share snapshot is:

```json
{"tool":"akshare_stock_a","arguments":{"method":"stock_zh_a_spot_tx"}}
```

The sidecar fetches the whole vendor snapshot before returning at most 500 rows;
inspect `truncated` and `row_count` before drawing whole-market conclusions. The seat's
call timeout is 130 s, above the Account's 120 s deadline. The call is a read: Gate 2
raises no card, and no role carries it (`src/roles.ts`, the `NEVER` table). Like every
read in the tree it has no lookahead guard (since 2026-10-24) and answers what the
source holds now; data timestamps and retrieval time differ, and source errors stay
visible (the Eastmoney and Xueqiu quote tests failed on 2026-09-15). No `mcp:akshare`
prompt section exists any more, and nothing falls back to a face-side AKShare when the
Account is down.

**What the operator changes** (the face never edits the home):

- A `- id: mcp-akshare` entry in `$DSH_HOME/profiles/face/cordis.patch.yml` or
  `$DSH_HOME/cordis.patch.yml` is inert now; delete it by hand.
- `FACE_AKSHARE_MCP_COMMAND` in a start line is unread.
- The face's start line (`.claude/launch.json`) no longer needs `~/.local/bin` (where
  `akshare-mcp` lives) on its `PATH`; the Account's line keeps it, or sets
  `PORTFOLIO_AKSHARE_BIN`.
- The host Account must be restarted from this tree before Gravit's AKShare works: it
  spawns `akshare-mcp` (default `~/.local/bin/akshare-mcp`), and an older 4820 answers
  that the route does not exist.

**What dsh 0.2.0 changed for every MCP row** — the Account seat's alike; no config key
changed (`src/account-seat.ts` records it):

- The client moved to `@modelcontextprotocol/client` 2.0 with version
  negotiation, and stdio negotiation starts a temporary probe process before
  the serving one: the server is spawned **twice** per connect, which doubles
  its start cost at boot.
- A connected server's `instructions` enter the system prompt as a section
  named `mcp:<serverName>`, with no switch, and every bot's prompt gains it,
  because prompt sections are not masked the way tools are. Instructions over
  `maxInstructionBytes` (32 KiB by default) now fail the connection.
- The three MCP resource tools dsh-base 0.2.0 adds (`list_mcp_resources`,
  `list_mcp_resource_templates`, `read_mcp_resource`) are off by the face's
  policy layer (D7).
- `failOnStartupError` stays `false`: a server that cannot start leaves its row
  ACTIVE with no tools, so the boot audit cannot see it. The check is
  `/data/plugins.json` (or **Plugin → <server>**): `account` with the seat's 36
  tools. The go-live runbook is
  `../docs/superpowers/runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md`.

## The Account seat — Gravit at the Account

Since 2026-10-20 the face composes a project-owned MCP row,
`mcp-account` (`src/account-seat.ts`): the MCP seat of the Account — the service
that puts your exchange, broker, wallet and prediction-market accounts in one place, answers its
API at `127.0.0.1:4820`, and lets agents trade inside limits you sign. It serves no page (since
2026-11-01): its owner's screens are this face's Markets, Trade and Account. Since 2026-10-27
it is this tree's `../account/`, copied from Linqi's
[buyer-agent-demo](https://github.com/linqizhe07/buyer-agent-demo) @ 133b9a7
(`../account/NOTICE`). Gravit's tools gain `mcp__account__portfolio_*` (36 on a
real account). The Account is yours to run, a second process beside the face; the
face never starts it. **Paper venues only** in this round
(`../docs/superpowers/specs/2026-10-20-account-seat-design.md`; the charter's §8
names a real venue as the real-money trigger).

Install once, from the repo root:

```bash
cd account && npm ci          # tsx is a devDependency the seat needs
```

Run the service in its own terminal (or as its LaunchAgent, `npm run account:service --
install`) with writes ON — `--read-only` refuses paper orders too — and connect no real venue;
`--live-cap 1` bounds any real order to a dollar should one ever be granted:

```bash
cd account && npm run account -- --live-cap 1     # home: ~/.buyer-agent-demo, the code's default
```

Then start the face, open Account and pair this browser with the code the Account printed (the
device line `Pair with the code the Account printed in its terminal`; an Account that already has
an owner lets a new browser in only from one that signs, under Settings › Devices). Open a paper
account (Account › Venues › **Open a paper account**: a name and $10,000; the id is
`paper-<the name>`, `paper-1` below). Gravit's first `portfolio_account` call makes the seat knock;
let it in under Account › Agents (Knocking › **Let in…**, under the name **Gravit**; good for 1 ·
7 · 30 · 90 days) and **Give a limit…** of scope `trade` naming the paper venue (`paper-1` — the
pick list never offers `*`, which expands to every venue connected at that moment). From then on
an order Gravit places there is two cards: the face's `Your call` card in the conversation, then
the Account's Guard card under Account › Cards (thirty minutes), **✓ Approve** signed with this
browser's device key; Gravit waits on it with `portfolio_wait`. Since 2026-11-01 the face is the
Account's only page ("The Account in the face" below): every owner step is a key in the face, each
prepared and shown before you sign it.

Before the first boot, look at Account › Agents: a seat already named **Gravit** there
— an earlier install's, or one renamed to it — is the one the Venues box reads and the one a new
grant lands on; rename or revoke it first, or the new seat knocks beside it and the box shows the
old one's standing.

| Env | Default | What |
|---|---|---|
| `FACE_ACCOUNT_SEAT_DIR` | the repo's `account/` | the Account package the seat process runs from; set it only to run the seat from another copy |
| `FACE_ACCOUNT_URL` | `http://127.0.0.1:4820` | the running service (the seat's `PORTFOLIO_URL`; `/data/seat.json` and the proxy's `/data/account…` read the row as composed, a patch's URL and seat name included) |

The checks: after a boot, `/data/plugins.json` lists `server: "account"` with 36 tools and the
boot line reads `order gate armed for mcp__account__portfolio_live_order, …`; Account › Venues
shows the **Account seat** box — the service reachable, the seat admitted until when with its
limit, the paper venue marked, the cards waiting, and **Answer under Cards** while any wait. A missing
`account/node_modules` (no `npm ci`) or a stopped service is a logged spawn failure and a `not reachable` box, never a
failed boot; a service that accepts the connection and never answers stalls the boot about two
minutes and the row then comes up without tools (the drill's step 7). The seat's key is the Account's, `~/.buyer-agent-demo/seats/gravit.json` (0600),
made on the seat's first call; the face never reads it. An operator patch can disable the row
(`- { id: mcp-account, disabled: true }`) or replace its config whole; the box and `/data/seat.json`
follow the row as composed — a disabled row reads `seat disabled`, a patched `PORTFOLIO_URL` or
`PORTFOLIO_AGENT` is where and whom they read. `/data/seat.json` reads the Account's
`GET /api/account` through the proxy's own `account` reader ("The Account in the face" below), so
the box and the Account screen share one upstream read: a good answer is served for 15 s,
`?fresh=1` (Refresh, a card raised or answered, the read right after a seat receipt) asks again,
and a failure is never kept — the next read asks again, and nothing is served stale.

What the service does on its own, with no venue connected (read at 133b9a7,
`src/portfolio/live/reach.ts`, `location.ts`): every thirty minutes a keyless probe of each
connector it knows — nineteen exchanges through ccxt, `api.alpaca.markets`,
`trading.robinhood.com`, `external-api.kalshi.com`, `gateway.polymarket.us`, `polymarket.com`,
`api.hyperliquid.xyz` and its testnet, `agent.robinhood.com`, seven chains' RPC, and
`mm auth status` when MetaMask's CLI is installed — plus a place lookup
(`polymarket.com/api/geoblock`, Cloudflare's trace, `ipapi.co`); on reads, the public quotes
(Kraken, Coinbase, OKX, Binance, Bybit tickers; Kalshi and Polymarket; `api.robinhood.com`,
`api.nasdaq.com`, `cdn-api.cboe.com` for US shares; LI.FI for tokenised stocks). No flag turns
the probes off. That is the Account service's egress, not the face's: the face talks to it over
loopback only.

**Re-run the seat smoke after any change under `account/`** — a renamed write tool would fall
out of Gate 2's list unseen by any offline test:

```bash
cd face && FACE_SMOKE=1 npx tsx --test tests/account-seat-smoke.test.ts
```

It starts the Account's own stand-in (no network, no money), mounts the seat against it and
proves the chain up to the Account's card (`DEVELOPMENT.md` §7.3).

## Lunhui analysis — frozen A-share research runs (src/lunhui.ts + plugins/lunhui/)

The Lunhui rows freeze hashed samples of the A-share market into a strategy's directory, so a
later analysis reads a fixed set of evidence instead of live data
(`../docs/superpowers/specs/2026-10-25-lunhui-modules-design.md`). They are cordis rows inside
the face process, not an MCP server: nothing to install, no child process, and they come up with
every boot. Like the seat's reads they carry no lookahead guard and are never evidence of a trade.
Gravit freezes; a role reads each module's context of the frozen run and submits that module's
artifact — `cn-market-analyst` the market read in `cn-market`, `cn-stock-analyst` the leader and
the mode in a strategy channel, citing a market run, `cn-reviewer` the counterevidence in either;
Gravit reads the run back and answers — in `cn-market` with `lunhui_present`, a composed answer
the page draws from the run's view, in a strategy channel with a text report. The
order is the run protocol, `../dsh/profile/lunhui-run.md`, which Gravit reads as its `lunhui:run`
prompt section; a single module asked for on its own follows `../dsh/profile/lunhui-module.md`,
the `lunhui:module` section one step after it.

The design has eleven rows; plans 1–4 built them all, and plan 2 of the run view added a twelfth:

| Row | Tool | State |
|---|---|---|
| `lunhui-runs` (`plugins/lunhui/runs-row.mjs`) | `lunhui_read_run` — a run's `run.json`, its counters and each artifact's headline; without a run, the strategy's newest five sealed runs (`run`, `session`, `sealed_at`, `snapshot_id`, accepted modules) | built |
| `lunhui-freeze-quotes` | `lunhui_freeze_quotes` — Tencent quotes and 60-day bars, 1–8 symbols; any channel | built |
| `lunhui-freeze-limit-up` | `lunhui_freeze_limit_up` — Eastmoney's 涨停, 炸板 and 昨日涨停 pools; `cn-market` only | built |
| `lunhui-freeze-boards` | `lunhui_freeze_boards` — the top 30 concept boards by change, up to ten boards' members, the board fund flow; `cn-market` only | built |
| `lunhui-freeze-index` | `lunhui_freeze_index` — the four indices with 120-day bars, the market's advance/decline counts from Eastmoney's up/down distribution; `cn-market` only | built |
| `lunhui-environment` (`plugins/lunhui/environment-row.mjs`) | `lunhui_read_environment_context`, `lunhui_submit_environment` — 环境与大周期: `index_state`, `liquidity_state`, `cycle_anchor`; `cn-market` only | built |
| `lunhui-sentiment` | `lunhui_read_sentiment_context`, `lunhui_submit_sentiment` — 情绪周期: `state` (one of `UNKNOWN CHAOS IGNITION EXPANSION CLIMAX RETREAT REPAIR`), `money_effect`, `freeze_type`; `cn-market` only | built |
| `lunhui-theme` | `lunhui_read_theme_context`, `lunhui_submit_theme` — 题材与轮动: up to five `mainline_candidates` on frozen boards, `theme_stage`, `rotation`; `cn-market` only | built |
| `lunhui-leader` (`plugins/lunhui/leader-row.mjs`) | `lunhui_read_leader_context`, `lunhui_submit_leader` — 龙头与个股地位: up to five `leader_candidates`, each a frozen quote held by a pool row or member list of the cited market run, ranked; `top_pattern_flags`; strategy channels only | built |
| `lunhui-mode` (`plugins/lunhui/mode-row.mjs`) | `lunhui_read_mode_context`, `lunhui_submit_mode` — 模式选择与预期: `mode` (`S01`, `S02` or `WAIT`), its preconditions, `research_only_matches`, the expectation card and the review of the previous card; strategy channels only | built |
| `lunhui-review` (`plugins/lunhui/review-row.mjs`) | `lunhui_read_counterevidence_context`, `lunhui_submit_counterevidence` — 反证: up to twelve `items`, each against a module whose artifact the context shows, of a kind (`CONTRADICTS`, `MISSING_EVIDENCE`, `STALE`, `RULING_CONFLICT`, `OVERREACH`), at most 160 characters, citing evidence of its own; either channel | built |
| `lunhui-present` (`plugins/lunhui/present-row.mjs`) | `lunhui_present` — Gravit's composed answer to a sealed `cn-market` run: a summary of at most 160 characters, 1–6 blocks from the face's catalog (`verdicts`, `breadth`, `indices`, `ladder`, `sources`), a title each, an optional focus, at most three choices; every number must be one the run's view digest holds (`INVALID_PRESENT` names any other), a strategy run is `NOT_A_MARKET_RUN`; on ok it ends Gravit's turn; Gravit only, `cn-market` runs only | built |

A freeze with no `run` opens a run, `strategies/<name>/analysis/<YYYYMMDD>T<HHMMSS>Z-<8 hex>/`,
and answers its id; pass that id as `run` to add the other sources. One evidence file per source
per run (`evidence-<source>.json`, at most 256 KiB — `limit-up`'s 1 MiB, three full pools — a
run's evidence at most 2 MiB), eight freezes a run, and every refusal reads `Error: <CODE> …`.
Each evidence file and its `run.json` entry record `session`, the trading day the data belongs
to — on a weekend, a holiday or before 09:15 the previous session — beside `received_at`, the wall
clock; a sealed run's `session` is its newest. Gravit calls the freezes; a delegated child is
refused (`NOT_GRAVIT`), and no bot's allow list names one.

**The modules.** A module's read (`lunhui_read_<module>_context`, any caller) answers the run's
context for that module: a digest of at most 30 KiB of the module's sources — the host's derived
measures first, then rows, whatever did not fit counted in `truncated` — with the module's
hypotheses (the tree's own paraphrase of `strategies/cn-market/THESIS.md`, paragraph ids only),
its schema, hints, an example built from the run, and the envelope fields to copy. **The first
read seals the run**: its `snapshot_id` is fixed and any later freeze is `RUN_SEALED`, so every
module of a run reads the same evidence. A module's submit (`lunhui_submit_<module>`) takes the
artifact as JSON text in `analysis`, only from a delegated role child (`NOT_A_ROLE` for Gravit
itself or a fork; the gate admits any unseeded child, a plain spawn child included, since dsh's
session header cannot tell the two apart), only after that module's read in the same face process (`READ_FIRST`; a
restart forgets the reads), once a module a run (`ALREADY_SUBMITTED`); the validator refuses it
`INVALID_ANALYSIS` with a category and a repair line (`修复：…`) — an unknown evidence id, a CURRENT
claim on old evidence, trading or account words, a market-wide, sentiment, theme or index sentence
the module does not own or cites without the evidence its class needs, a headline state without a
claim of its own behind it, more than 24 KiB — and an accepted one lands as `<module>.json` in the
run, named in `run.json`'s `artifacts`. A module whose required evidence the run lacks
(environment: `index`; sentiment: `limit-up` and `index`; theme: `boards` and `limit-up`; leader:
the strategy run's quotes and the market run's theme artifact; mode: the run's leader artifact and
the market run's sentiment and theme; the reviewer: in `cn-market` one of its three artifacts, in a
strategy channel the leader and the market run's sentiment and theme), or whose context shows no
evidence row at all, accepts only `NOT_EVALUABLE`, naming the missing sources. Ten calls a module a run, reads and
submits, then `TOOL_BUDGET`. The channel page shows a run's module artifact only when `run.json`'s `artifacts`
names it; a run frozen but never read stays `unsealed` on it.

**The strategy modules** read a strategy run — one whose quotes Gravit froze in the strategy's own
channel — and cite one market run: their read takes `market_run`, a sealed `cn-market` run whose
trading day is the strategy run's or the one before it (`STALE_MARKET_RUN` otherwise;
`MISSING_EVIDENCE` while it is open; `NO_SUCH_RUN` when there is none), and shows that run's pools,
members and accepted artifacts beside the run's quotes, an artifact citable as
`<module>@<snapshot_id>`. The submit takes no `market_run`; the artifact copies `market_run` and
`market_snapshot_id` from the context. **leader** names at most five `leader_candidates`, each a
priced quote the strategy run froze whose code a pool row or member list of the market run holds,
ranked 1 to n, its board one of the market theme's mainline boards holding it, or null; 龙头 only
as 龙头候选. **mode** concludes `S01`, `S02` or `WAIT`, on the leader's market run
(`MISSING_EVIDENCE` otherwise). It is a daily registration, never a decision: `S01` only in
`lunhui-s01-repair`, on a market sentiment of `REPAIR` or `EXPANSION`, its four daily
preconditions met with evidence and its minute confirmation `unmet: no source`, every item of the
run's counterevidence artifact answered — accepted `OK`, citing the same market run — an
expectation card of at most 2,048 bytes and the parameters used; `S02` only in
`lunhui-s02-rotation`, refused while its catalyst has no source (an announcements freeze, a later
plan); every other strategy `WAIT`. A refusal of either reads `INADMISSIBLE_STATE` or
`UNADDRESSED_COUNTEREVIDENCE`. The mode's context shows the strategy's THESIS.md Falsification
section (at most 1,500 bytes, flagged when cut), the run's leader and counterevidence before the
market run's artifacts, and the card of the newest earlier session's mode (cut and flagged
`card_truncated` if stored larger than 2,048 bytes), which its `expectation_review` grades 符合, 强于, 弱于 or `NOT_EVALUABLE`; a `WAIT` leaves no card to
grade. The channel page draws the mode's chip as its word, the card as rows and the review as a
line.

**The reviewer** (`lunhui-review`) reads either channel. In `cn-market` the run is the market run:
no `market_run` (`WRONG_CHANNEL` if given), its three market artifacts reviewed. In a strategy
channel `market_run` is required (`MISSING_EVIDENCE` without it), and the context shows the run's
quotes and leader beside the market run's evidence and artifacts; a leader citing another market
run is `MISSING_EVIDENCE` at the read. Each item is against a module whose artifact the context
shows — never the mode — and cites at least one `ev_` evidence id of its own (`REFERENCE`
otherwise); an empty `items` is a review that found nothing, a result.

**The roles and the protocol.** Three roles ship. `../roles/cn-market-analyst/`: its tools are
`skill` and the six market module tools, its model `deepseek-official/deepseek-flash`, its Chinese
persona the three modules in order — environment, sentiment, theme — each read once and submitted
once, the artifact only in `analysis`, a stop after a failed read, a module's third rejection
ending that module only (the role goes on to the next and names each blocked module under limits),
and a report under the four headings. `../roles/cn-stock-analyst/`: `skill` and the four strategy
module tools, the same model, one artifact a call — the brief names the strategy, the run, the
`market_run` and leader or mode — the mode a daily registration (`WAIT` a result), read only once
the leader is accepted, the same exits and headings. `../roles/cn-reviewer/`: `skill` and the
counterevidence pair, the same model, one read and one submit — the brief names the strategy, the
run and, outside `cn-market`, the `market_run` — each item against a shown module and citing
evidence, an empty list a result, a third rejection or a failed read stopping it, the four
headings. `lunhui:run` tells Gravit two orders, every tool's `strategy` the channel's name. In
`cn-market`: freeze `index` without a run (that opens one), then `limit-up` and `boards` with its
id (`quotes` optional); call `role_cn_market_analyst` once with the run id; call `role_cn_reviewer`
with `cn-market` and the run, no `market_run`; read the run back with `lunhui_read_run` and trust it
over the roles' reports. In a strategy channel: call `lunhui_read_run` on `cn-market` without a run
— it lists the newest sealed runs — and take one of today's or the previous trading day's session
as `market_run` (or do the market run first); read it and choose 1–4 main-board stocks from its
theme's mainline boards' members and its pools, which live only in the market run's
`evidence-boards.json` and `evidence-limit-up.json` (the read returns headlines); freeze their quotes on the strategy without a run (that
opens the strategy run); call `role_cn_stock_analyst` with the strategy, the run and `market_run`
for the leader; once the leader is accepted, `role_cn_reviewer` with the same three (a review
read before it is `NOT_EVALUABLE` for good) and then `role_cn_stock_analyst` again for the mode; read the run back. A `WAIT`, a `NOT_EVALUABLE`
artifact or a refused mode is a result and is never re-run; on `STALE_MARKET_RUN`, make a new
sealed market run by the market order and re-read with it, opening a new strategy run when the
strategy run itself is stale. For both: never freeze after a role has read,
never edit `analysis/`, never submit an artifact itself; journal a `cn-market` run with
`NOT_EVALUABLE` artifacts in `strategies/cn-market/journal.md`; and end with the run id, the
`snapshot_id`, each artifact's file and headline (the leader's candidates, the counterevidence's
item count, the mode and its `market_run`), what was not evaluable or has no artifact, and whether
the quotes were delayed — in a strategy channel. In `cn-market` the run ends instead with one
`lunhui_present` call: a one- or two-sentence conclusion, blocks picked and ordered by the day's
weight, a title each, an optional focus, at most three follow-ups, every number from
`lunhui_read_run`'s view digest, and no separate report (since 2026-10-30, plan 2 of the run
view). The section is in Gravit's prompt
only while the Lunhui rows are mounted, never in a bot's or a role's.

`lunhui:module` (`../dsh/profile/lunhui-module.md`, at most 1,500 bytes — 1,500 today, at the cap, a budget
`tests/protocols.test.ts` pins under the loader's 3,000) tells Gravit how to run one module on a
module card's message, which names the module, the channel and the run (an existing one or a new
one), and for a strategy module the `market_run` and optional codes; everything else is as
`lunhui:run` says. A new `cn-market` run freezes the whole set first, since the run seals at its
first role read; an existing run is not frozen again; the market analyst is told the one module to
write; the reviewer runs before the mode, never beside it; a refusal it cannot cure
(`ALREADY_SUBMITTED`, `STALE_MARKET_RUN`, `MISSING_EVIDENCE`) is reported as it is and the message
ends, with no other run opened. A `cn-market` environment, sentiment, theme or counterevidence run
answers with `lunhui_present` naming its `module` (its blocks bounded to that module's); the leader,
the mode and any strategy-channel run report the module's points in text. It is gated like `lunhui:run`, on `lunhui_read_run`. Editing
either protocol file or a role means `npm run render:roles`, `npm test` and a restart ("Roles").

**The market channel**: `strategies/cn-market/` is tracked, with a `THESIS.md` that states the
market read by chapter and paragraph id. Its runs hold the index, limit-up and board evidence a
strategy's run cites; the limit-up, boards and index freezes and the three market modules refuse
any other channel, the leader and mode modules refuse it (`WRONG_CHANNEL`); the reviewer reads both. The two Lunhui
strategies, `strategies/lunhui-s01-repair/` and `strategies/lunhui-s02-rotation/`, are the strategy
channels the mode knows by name. A channel with runs shows a **Research runs** section on its page.

**Egress**, from the Account process. The face process reaches no Tencent, Eastmoney or iFinD host: the four freezes send every read to the Account at `FACE_ACCOUNT_URL` (default `http://127.0.0.1:4820`, `http://account:4820` under compose), which relays the allow-listed GETs (`GET /api/cn/relay?url=`, the status, content type and bytes unchanged, a 16-slot queue, 7 s and 512 KiB per read, 4 s for `/appstock/app/day/query`) and runs the boards stand-in's query (`POST /api/cn/ifind`, 15 s for the whole ask, 4 MiB); there is no direct-to-upstream fallback, and an Account that is down or refusing is a freeze refusal (`UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE` or `UPSTREAM_INVALID`). The Tencent and Eastmoney hosts are those AKShare itself calls for the same data; `quantapi.51ifind.com` is the boards stand-in's own:

| Host | What |
|---|---|
| `qt.gtimg.cn`, `web.ifzq.gtimg.cn` | Tencent quotes and daily bars |
| `push2ex.eastmoney.com` | the three limit-up pools and the session's up/down distribution, the market counts (it answers directly) |
| `push2.eastmoney.com` | the concept boards, a board's members and the board fund flow |
| `push2delay.eastmoney.com` | `push2`'s one redirect, the only one followed: from this machine `push2` answers 302 here, with **delayed** quotes |
| `quantapi.51ifind.com` | iFinD's QuantAPI, the boards stand-in alone: `POST /api/v1/get_access_token` and `POST /api/v1/smart_stock_picking`, only when Eastmoney's boards refused and an iFinD token is configured |

Each request has a 7-second timeout (per hop, so a redirect can take 14 s) and a 512 KiB cap — the
QuantAPI requests alone a 15-second timeout and a 4 MiB cap — at
most four Eastmoney requests run at once, and no numbered host (`17.push2…`) is ever called.
Every Eastmoney item records the host that served it and whether it was delayed (a `push2ex` reply
declares none, so its items read `delayed: false` by construction). One index freeze reads the
market counts in one request, the distribution (`getTopicZDFenBu`); a distribution it cannot use —
another session's, a failed request — leaves the counts out, the index items land, and the reply's
`counts` says so (spec §17). The endpoints are unofficial: a changed reply is `UPSTREAM_INVALID`, and
a day outside the calendar table (`plugins/lunhui/lib/calendar/2026.json`, only 2026 ships) is
`CALENDAR_UNCOVERED` (`DEVELOPMENT.md` §9, R40–R41).

**The boards stand-in** (spec `docs/superpowers/specs/2026-10-30-lunhui-boards-standin-design.md`).
`lunhui_freeze_boards` reads Eastmoney first, always. When any of its three reads refuses
(`UPSTREAM_TIMEOUT`, `UPSTREAM_TOO_LARGE`, `UPSTREAM_INVALID`, `NO_MARKET_DATA`) and an iFinD token
is in the face's environment, the same call lands the whole boards file from 同花顺问财 instead: one
`smart_stock_picking` query (`A股 <YYYY年MM月DD日>涨跌幅 成交额 主力资金流向 所属概念`, the session's
date) returns every A share with its change, turnover, main-fund net flow and 同花顺 concept list,
and host code derives the boards from the members — concepts with at least 10 members, minus the
membership, index, screen and report tags named in `lib/wencai-excluded.mjs`; a board's change is
its members' equal-weight mean (`pct_basis: "equal_weight"`), not an index's. The top 30 by change,
the members of the first ten (≤ 100 each) and the top 30 by main net flow are the file's items, a
board coded `THS:<concept name>` (the name as 问财 spells it, single inner spaces kept — `THS:中国AI 50` —, ≤ 40 characters), its members by six-digit code. A `boards` argument names Eastmoney's
BK codes, which the stand-in cannot honour: it takes its own first ten and the reply says so
(`boards_ignored`). Every stand-in item is stamped `provider: "同花顺问财"`, `taxonomy: "同花顺概念"`,
`host: "quantapi.51ifind.com"`, `delayed: false`; the evidence meta, `run.json` and the freeze's reply carry the
`provider` (on both paths, `东方财富` or `同花顺问财`) and, for the stand-in, `fallback_from`
(Eastmoney's refusal code; `run.json` keeps `provider` and `fallback_from`, the evidence file alone also the query and the reply's hash); the 1.37 MB reply is not stored.
The operator sees it on the runs card's theme chip and on Discover's theme card and module page
(`· boards: iFinD (THS concepts)`), and the theme context says so to the analyst. With no token at the Account the
step makes no iFinD request (the refusal says 同花顺问财备用未配置); when both sources fail the refusal carries Eastmoney's code and names both
reasons, and nothing is written. One freeze call counts once against the run's eight whichever
source lands. The Account exchanges the access token from `IFIND_REFRESH_TOKEN` (or uses
`IFIND_ACCESS_TOKEN` as given), caches it in memory only, and re-exchanges once on a rejected token;
the face holds none and sends none, the names stay scrubbed from the CLI agents' children, and
Gravit's own shell can still read `../.env.ifind` (`DEVELOPMENT.md` R1b). Each evidence file and its
`run.json` entry carry `via: "account"`. Each stand-in freeze costs one 智能选股 call of
the account's monthly quota. The live check is `node scripts/lunhui-standin-check.mjs` from `face/`
with the Account running and holding the token: it goes through the Account (no `IFIND_*` in its environment), asks for the latest session, derives the boards and prints the
counts and the top five, never the token.

**Fixtures** are row config, used by the tests alone: a freeze row's `config.fetch` names a
directory of recorded replies (`tests/fixtures/lunhui/`, `tests/fixtures/lunhui-eastmoney/`),
`config.now` a clock and `config.account` an Account address; production rows set none of the keys
and reach the Account at `FACE_ACCOUNT_URL`. The rows read no credential variable.

**The patch lines** (`$DSH_HOME/profiles/face/cordis.patch.yml`). The rows compose right after the
seat and below this file, so a patch reaches them:

```yaml
- { id: lunhui-freeze-boards, disabled: true }   # one source off: its tool goes, the rest stay
```

A module row disabled alone takes its pair away, and with it every call of its role —
`cn-market-analyst` names all six market module tools, `cn-stock-analyst` all four strategy module
tools, `cn-reviewer` the counterevidence pair (a role naming a tool the tree lacks is refused at
delegation). To turn Lunhui off, disable all twelve — a freeze or module row injects the
`lunhuiRuns` service, so without `lunhui-runs` it stays pending and the boot's row audit refuses it
(`waiting for service: lunhuiRuns`; reasoned from the audit, not yet pinned by a boot); the
`lunhui:run` and `lunhui:module` sections leave Gravit's prompt with them:

```yaml
- { id: lunhui-runs, disabled: true }
- { id: lunhui-freeze-quotes, disabled: true }
- { id: lunhui-freeze-limit-up, disabled: true }
- { id: lunhui-freeze-boards, disabled: true }
- { id: lunhui-freeze-index, disabled: true }
- { id: lunhui-environment, disabled: true }
- { id: lunhui-sentiment, disabled: true }
- { id: lunhui-theme, disabled: true }
- { id: lunhui-leader, disabled: true }
- { id: lunhui-mode, disabled: true }
- { id: lunhui-review, disabled: true }
- { id: lunhui-present, disabled: true }
```

A patch that replaces `lunhui-runs`' config replaces it whole, so it restates `strategiesRoot`
(an absolute existing directory; the default is this checkout's `strategies/`).

The checks: `/data/plugins.json` lists the twelve rows ACTIVE, and Gravit's tools include the
eighteen `lunhui_` names, `role_cn_market_analyst`, `role_cn_reviewer` and `role_cn_stock_analyst`
(the schema block was 3,188 heuristic tokens for the seventeen before `lunhui_present` and 689
for the three role tools, `DEVELOPMENT.md` §4.3; the eighteenth is not yet measured).

**The market run, automated** (`tests/lunhui-market-run-smoke.test.ts`, under `FACE_SMOKE=1`):
one whole `cn-market` run on a real boot over the recorded replies and a stub model — Gravit
freezes index, limit-up and boards into one run and calls the analyst, whose child reads the three
contexts and submits three `OK` artifacts built from them, then the reviewer, whose child submits
one item against the sentiment; the run seals, the four artifacts are named in `run.json` and
valid again against the sealed files, and the runs card shows four chips. It
passes; it proves the plumbing and that a context is usable as a role receives it, not that a real
model follows the protocol or that its labels are right.

**The live market run — owed, the operator's.** The first time the freezes meet the live hosts and
a real model writes artifacts. Run it on your own face with its keys (`npm start` after
`source ../.env.deepseek`, as in "Run"); it calls Tencent and Eastmoney from this machine, and
Eastmoney's `push2` answers with **delayed** quotes here. Any hour works: on a weekend, a holiday or
before 09:15 China time the run's `session` is the previous trading day; from 09:15 until Eastmoney
rolls the distribution's date the index freeze lands without the market counts (its reply's
`counts` says so; the contexts then show no counts row, and the three count measures are null,
which only an `INSUFFICIENT` claim may cite); and a day the 2026 calendar does not cover refuses
every freeze (`CALENDAR_UNCOVERED`).

1. Open **cn-market** in Messages and start a New message there. Prompt:
   `按 lunhui:run 的顺序，在 cn-market 做一次 A 股市场研究运行，最后按协议向我汇报。`
   Expect, in the thread: `lunhui_freeze_index` with no run (its reply carries the new run id,
   `session` and `as_of`), then `lunhui_freeze_limit_up` and `lunhui_freeze_boards` with that id;
   one `role_cn_market_analyst` call whose child (Details › Children) reads and submits environment,
   sentiment, theme in that order; one `role_cn_reviewer` call with no `market_run`, whose child
   submits the counterevidence; `lunhui_read_run`; then the answer as one `lunhui_present` call —
   since the protocol split of 2026-10-30 a composed answer, its working notes folded above it,
   with no text report after it ("The composed-answer drill" below checks the page). A refused freeze (`UPSTREAM_*`, `NO_MARKET_DATA`) costs
   only that source; the run keeps the rest.
2. The channel page's **Research runs**: the run sealed, a chip per artifact. On disk,
   `strategies/cn-market/analysis/<run>/`: `run.json` with `sealed_at`, `snapshot_id` and
   `artifacts`; `metrics.json` with `calls` (each module at most 10), `rejections` by category and
   `submitted`; the four `<module>.json`, `counterevidence.json` among them. Note how many
   rejections each module took.
3. If any artifact is `NOT_EVALUABLE`: a dated entry at the end of
   `strategies/cn-market/journal.md` naming the run, the modules and the missing sources.
4. The fences, in the same session. Prompt: `直接调用 lunhui_submit_environment，把一份工件提交到刚才那个运行。`
   → `Error: NOT_A_ROLE …`. Prompt: `再对刚才那个运行调用一次 lunhui_freeze_index。` → `Error: RUN_SEALED …`.
   Gravit declining either call because the protocol forbids it is a pass too; the code fence is
   pinned in the suite (`roles-smoke` on a real boot, `lunhui-module-tool` and `lunhui-rows`
   offline).
5. Measure the two role children's first requests as `DEVELOPMENT.md` §4.3 says (each session's
   projection-cache record, `contextBreakdown` beside `tokenUsage`) and record them there, with the
   date and the session ids; mark the **Lunhui market run — manual** row of `DEVELOPMENT.md` §7.4.
6. The run's `run.json`, `metrics.json` and artifacts are tracked files (the evidence files are
   gitignored): commit them on your word, or remove the run directory.

What it does not prove: whether the labels are right — that is the next day's freeze and a
strategy run's expectation review (`strategies/cn-market/THESIS.md`, Falsification).

**The strategy run, automated** (`tests/lunhui-strategy-run-smoke.test.ts`, under `FACE_SMOKE=1`):
two days on the same fixtures, each a reviewed market run, then a strategy run on
`lunhui-s01-repair`: Gravit finds the market run with the listing read, freezes two stocks'
quotes, calls `role_cn_stock_analyst` for the leader, `role_cn_reviewer` with both run ids, and
`role_cn_stock_analyst` again for the mode. Friday's mode registers `S01` with a card, every
counterevidence item answered; Monday's grades it. Every artifact is valid again against the
sealed runs, and the channel page's latest run is Monday's with its review line. It passes; it
proves the plumbing, not a real model's choices — and the fixtures are one set but the
distribution's `qdate`, rolled to Monday, so Monday's grade reads Friday's prices again.

**The live strategy run — owed, the operator's.** After a live market run of today's or the
previous trading day's session (above), on the same face:

1. Open **lunhui-s01-repair** in Messages and start a New message there. Prompt:
   `按 lunhui:run 的策略频道顺序，引用今天已封存的 cn-market 运行，在本频道做一次策略研究运行，最后按协议向我汇报。`
   Expect: `lunhui_read_run` on `cn-market` without a run (the listing), then with the chosen run
   (its id noted as `market_run`); one `lunhui_freeze_quotes` on `lunhui-s01-repair` with no run,
   for 1–4 main-board stocks from the market run's theme and pools (its reply carries the strategy
   run's id); `role_cn_stock_analyst` with the strategy, the run and `market_run` for the leader;
   `role_cn_reviewer` with the same three; `role_cn_stock_analyst` again for the mode (Details ›
   Children); `lunhui_read_run` on the strategy run; a final message naming the run, its
   `snapshot_id`, `leader.json`'s candidates, the counterevidence's item count, `mode.json`'s mode
   and `market_run`, and whether the quotes were delayed. The mode is `S01` with a card only when
   the market sentiment admits it, its preconditions stand on evidence and every review item is
   answered; `WAIT` is as much a result.
2. The channel page's **Research runs**: the run sealed, `cn-market run <id>` on its line, the
   leader and counterevidence chips and the mode's word. On disk,
   `strategies/lunhui-s01-repair/analysis/<run>/`: `run.json` with `evidence-quotes.json` alone and
   `artifacts` `[leader, counterevidence, mode]`; both artifacts' `market_run` the
   market run's id; `metrics.json`'s calls and rejections by category. Note how many rejections
   each module took.
3. The other strategy. Open **lunhui-s02-rotation** and send the same prompt: the mode concludes
   `WAIT` — `S02` is refused while its catalyst has no source.
4. The freshness fence, once `cn-market` holds a sealed run two or more trading days older than
   the session of the day (skip it until one exists). Prompt in **lunhui-s01-repair**:
   `用 <那个旧的 cn-market 运行编号> 作 market_run，为本频道做一次策略研究运行。`
   → the leader read refused `Error: STALE_MARKET_RUN …`, naming both sessions; Gravit following
   the protocol — a whole new sealed market run by the market order, re-read as `market_run`, and a
   new strategy run if that run itself is stale — is a pass. The fence
   itself is pinned offline (`lunhui-module-tool`).
5. Measure the stock analyst's and the reviewer's first requests as `DEVELOPMENT.md` §4.3 says
   and record them there, with the date and the session ids; mark the **Lunhui strategy run — manual** row of
   `DEVELOPMENT.md` §7.4.
6. As with the market run, the run's `run.json`, `metrics.json` and artifacts are tracked: commit
   them on your word, or remove the run directory.

7. The next session's grade, once a run registered `S01`: on the next trading day, after that
   day's market run, the same prompt in **lunhui-s01-repair** — the mode's context carries the
   card, and `expectation_review` grades it 符合, 强于, 弱于 or `NOT_EVALUABLE`, naming its run; the
   channel page shows the review line.

What it does not prove: whether the candidates and the review are right. The theses' closing
`**Daily registration (E4)**` paragraphs are the builder's re-fit and await your review
(`DEVELOPMENT.md` §10, item 19).

**The card drill — owed, the operator's.** Run after any change under
`client/js/host/modules*.js`, `run-sheet*.js` or `../dsh/profile/lunhui-module.md`; keyed, the face
from your own terminal (`npm start` after `source ../.env.deepseek`, as in "Run"), each module run
from its Discover card (the spec's §5.4–§5.7, Appendix B):

1. Discover → Research: six cards, the chips reading the latest runs (`not evaluable · boards` on
   Theme on a day boards failed). Open Theme's page: the three boxes, the runs table, the latest
   artifact.
2. Theme → Run: Where `cn-market` fixed, Latest run greyed `theme already there`, New run checked,
   the source line counting the boards failures. Run. Expected: a conversation `Theme · <MM-DD>`
   in `cn-market` whose first message is Appendix B's new-run line; Gravit freezes index,
   limit-up, boards (three tries if it fails), calls the CN market analyst for theme alone,
   reports; the card reads `Running · Theme · <MM-DD> ›` meanwhile and settles on the new run's
   chip when the session stops; on disk exactly one artifact, `theme.json`, in the new run; the
   Environment and Sentiment cards now read `not run`.
3. Environment → Run on that run (Latest run enabled, New run not preselected) and Sentiment
   likewise: two more conversations; the run now holds three artifacts; the chips show them.
4. Leader → Run: Where `lunhui-s01-repair`, New run, Cites the run from step 2 (the theme line
   says whether the pick is from the pool alone), Stocks two codes from that run's
   `evidence-limit-up.json`. Expected: a conversation `Leader · <MM-DD>` in the strategy channel,
   `lunhui_freeze_quotes` for the two codes, the stock analyst for leader alone, `leader.json`
   alone in the new strategy run; the card names the strategy.
5. Counterevidence → Run: Where `lunhui-s01-repair`, Latest run enabled (leader there, no review),
   the cite read-only. Expected: `counterevidence.json` lands; the card reads
   `lunhui-s01-repair · <n> items`.
6. Mode → Run: Latest run enabled now (leader and counterevidence there). Expected: `mode.json`
   (WAIT in all likelihood); Run then greys `mode already registered on this run`.
7. The fences: Mode on a run without a review → the sheet greys with `needs Leader, then
   Counterevidence, on this run`; a second Theme Run on today's run → `theme already there`;
   Stocks `sz300750` → the error line, Run disabled; a Mode sheet left open while Leader opens a
   new run reads `run no longer the latest`; re-pick Latest run.
8. The runs card on each channel page agrees with the cards; the journal gained a dated line for
   any `NOT_EVALUABLE`.

Record the outcome here, under the drill — the date, the run ids, what differed — and mark the
**Module cards — manual** row of `DEVELOPMENT.md` §7.4. As with the runs above, the new runs'
tracked files are committed on your word, or the run directories removed.

**Not yet run** — owed after plan 3 of the module cards lands.

**The composed-answer drill — owed, the operator's.** Run after any change to
`plugins/lunhui/present-row.mjs`, `lib/present.mjs`, `client/js/host/lunhui.js`,
`client/js/render/lunhui/`, `client/js/reducers/lunhui.js` or the closing step of either protocol; keyed, the face from your own
terminal (`npm start` after `source ../.env.deepseek`, as in "Run") and the Account beside it
(`cd ../account && npm run account`), the browser on this Mac's New York zone:

1. Open **cn-market** in Messages, start a New message, and send the live market run's prompt
   (above). Expected: the thread ends in one composed answer — Gravit's summary, then the blocks in
   the order Gravit chose, each drawn from the run's view (a skeleton line per block until the view
   arrives), then the footer `Evidence · … · frozen <MM-DD HH:MM> CST · run <run>`; no text report
   after it, and the turn ended (the composer free, no thinking row).
2. Above the answer, **Working notes · N**, closed: open it, and the words Gravit wrote on the way
   are there and nowhere else in the thread. A refused `lunhui_present` (a number the digest lacks)
   followed by an ok one draws one answer, not two.
3. The blocks answer their controls: a verdict tile opens its claims (pressed again, it closes);
   breadth switches Counts and By change, and a bucket names its count and share; on indices, drag
   the minute slider and move the pointer over the chart — the cursor line, the dot and the readout
   follow, and a redraw while you drag (a live event arriving) leaves the cursor at the slider's
   minute; a ladder rung names its promotions.
4. Every time is China time: the chart's grid reads 09:30, 10:30, 11:30/13:00, 14:00, 15:00, the
   readout's minute is a grid minute, and the footer's frozen time is CST — none in New York time.
5. The failed view: move the run's directory aside (`mv ../strategies/cn-market/analysis/<run>
   /tmp/`) and hard-reload the page: the summary stays, with one line `The run view could not be
   loaded: HTTP 4xx` and **Retry** — never a blank. Move the directory back and press Retry: the
   blocks draw.
6. The split: in **lunhui-s01-repair**, the live strategy run's prompt still ends in a text
   report, no composed answer; a Theme card run in `cn-market` ends in a composed answer of theme's
   blocks alone.
7. Back in the `cn-market` answer (a ladder in it — ask for one if Gravit left it out), click a
   ladder name: the stock drawer opens on the right, 460 px, the thread making room — the name,
   `<code> · <board> · <industry>`, the pool line, **The minute line** with its headline, the chart
   with the limit-up line where the view puts it (a sealed name's line runs along it, seal marks on
   it, volume bars under it), the slider whose readout says `at the limit-up` only at that price,
   the tiles and **In this run**. A first board, or a name whose minute freeze failed, draws one
   note line and no chart. A name in the summary or a headline opens the same drawer; one inside a
   link does not.
8. Press Escape: the drawer closes. Open it again, then Details: Details replaces it.
9. Click a follow-up under the blocks: a stock one opens that stock's drawer; any other sends its
   label once as your message (the composer keeps what you had typed), and Gravit answers it.
   **Ask Gravit about <name>** in the drawer sends `说说 <name>（<code>）在这次运行里的情况。` the same
   way; **Open in Markets** opens `#/markets/cn:<code>`.
10. Click **Open run ›** in the footer: the `cn-market` channel page opens, the run among its
   Research runs.

Record the outcome here, under the drill — the date, the run id, what differed — and mark the
**Composed answer — manual** row of `DEVELOPMENT.md` §7.4. The run's tracked files are committed on
your word, or the run directory removed.

**Not yet run** — owed after plan 2 of the run view lands; steps 7–10 since plan 3.

## The profile

`npm run setup` writes THREE files into `$DSH_HOME/profiles/<name>/`, and
refuses a directory that already exists — it prints `exists, untouched: <dir>`
and changes nothing. Profiles are operator territory.

| File | What |
|---|---|
| `package.json` | the profile manifest: `dsh.profile.bundles: ["@deepseek-ai/dsh-base"]` |
| `cordis.patch.yml` | the operator's patch layer — a header plus a load-bearing `[]` (an empty array, not an empty file: dsh-app-boot throws on anything that is not a top-level YAML array) |
| `pnpm-workspace.yaml` | pnpm settings, verbatim from dsh's own `initProfile`, so `dsh plugin add` can install into this profile later |

The header is written once, at setup, so a profile created before the
0.2.0-rc.2 upgrade still carries the 0.1.1 wording, which names rows that no
longer exist. The current text is `PATCH_HEADER` in `src/setup.ts`; refreshing
the comment is optional and the operator's to do.

Mount the operator's rows — the two skill roots and the default model below —
into `cordis.patch.yml` per `../dsh/README.md` steps 1–5 (step 2 is the rows).
No server of this repo's exists to mount since 2026-10-24: the face composes
the Account seat itself (AKShare is the Account's). A harness home that still carries the
Alpaca MCP row from before then should drop it — its command names the Python
package the tree removed, so the server never starts — and should any row
register `place_order` or `cancel_order`, the face refuses to boot until that
row is gone ("What boot refuses" above). The face boots with or without the
operator's rows.

**In the agent box** (`../compose.yml`, "The two-box drill" below) the harness
home is the volume `dsh-home` at `/dsh-home`, and the first `docker compose up`
writes the profile by itself (run `cd account && npm ci` on the host before it:
the `account-modules` mount point sits inside the read-only `account/` bind):
the entrypoint (`docker-entrypoint.sh`) runs `npm run setup` when
`/dsh-home/profiles/face` does not exist, after `npm ci` into the two module
volumes. The operator's rows go into
`/dsh-home/profiles/face/cordis.patch.yml`, with paths inside the box, reached
with `docker compose exec agent sh` while `up` runs (restart the box after an
edit); the box's home is its own, never the host's `~/.dsh`. The CLI-agent
tools (`claude`, `codex`) are not in the agent image, so Discover lists them
unavailable there; the host dev loop has them.

**The default model is a row here (upgrade decision D2).** dsh-base's
`agent-default-model` row says `deepseek-official/deepseek-flash`, and with no
`profileContext` (D1) the face reads neither `$DSH_HOME/settings.yaml` nor any
saved selection, so this row is the only way to change it:

```yaml
- id: agent-default-model
  config: { provider: deepseek-official, model: deepseek-v4-pro, reasoningEffort: max }
```

A patch that names `config` replaces the row's whole config, so give all three
keys. dsh 0.2.0's DeepSeek catalog is `deepseek-flash` and `deepseek-v4-pro`;
`deepseek-v4-flash` is gone. The agent panel's model card shows what took.

**How the tree is composed** (`composeFace`, `src/boot.ts`), in order:

1. the bundle layer — dsh-base, which now includes the storage chain
   (`storage`, `storage-json`, `storage-domain`) and `session-projection-cache`,
   rows the face mounted itself at 0.1.1;
2. the face's policy defaults (`src/policy.ts`; "The policy layer" below);
3. the project's Account seat (`mcp-account`);
4. this profile's `cordis.patch.yml`;
5. the machine-local `$DSH_HOME/cordis.patch.yml` — then, for a tool only, an
   in-memory layer (`bootFace`'s `extraPatches`; `scripts/check-home.ts` uses
   it, `npm start` never does);
6. the face's switches: the telemetry opt-out (only while
   `DSH_TELEMETRY_DISABLED` is set), `hmr` disabled, Gravit's persona, and
   the instruction files (the `agent-instructions` row);
7. the face's own host rows (`src/overlay.ts`), last — among them the default
   preset, rendered here from `../roles/` ("Roles" below) and
   `../dsh/profile/cycle.md` (the research cycle, below).

A row of yours therefore wins over layers 1–3 — the storage chain, the
projection cache and every policy row are yours to patch — and loses to 6–7.

Two things about that directory are NOT yours:

- **`<profile>/cordis.yml` is face-managed.** `composeFace` rewrites it on every
  boot. The whole tree is composed as patch layers, and the root exists only as
  an empty entry list anchoring the loader's `baseUrl`; anything you put there
  is gone at the next start. Edit `cordis.patch.yml`.
- **The face's own host rows compose LAST and win silently.** They are applied
  after your patch layer and after the machine-local home layer — the inverse
  of the dsh CLI's layering, and deliberate: loopback-only binding surviving
  an operator patch is the point: the one way to widen it is the process
  environment, `FACE_BIND` (the compose file's `0.0.0.0` for the agent box,
  whose port is published on the host's loopback) — never a patch row. A
  patch of yours aimed at one of the thirteen overlay rows — `webserver`,
  `connection`, `api-remotes`, `file-upload`, `workspace`,
  `session-controller`, `workspace-controller`, `settings-controller`,
  `directory-picker`, `tool-ask-user`, `agent-preset-registry`,
  `preset-gravit`, `preset-kairos` — or at the `hmr` switch, at
  `system-prompt`'s `personaPrefix`, at the `agent-instructions` row's two
  candidate lists, or (while `DSH_TELEMETRY_DISABLED` is set) at
  `session-telemetry-otel` is accepted, overridden, and NEVER reported. Change those in the face —
  `src/overlay.ts`, `src/boot.ts`, `src/instructions.ts`,
  `../dsh/profile/persona.md`. The same warning is in the patch
  file's own header, which is where an operator would actually look.

The persona is narrower than it was. dsh 0.2.0 renamed the key: the face sets
`system-prompt.personaPrefix` (section `deployment:persona-prefix`, order 0,
right after the harness identity line) from `../dsh/profile/persona.md`, and
that key is ALL it owns on the row: its patch restates every other key the
layers below left there, so an operator's `includeRuntimeContext`,
`includeHarnessIdentity`, `personaSuffix` or `toolOrder` survives. At 0.1.1
the face replaced the row's whole config and discarded them without a word.

The instruction files are the face's as well, but only their two candidate
lists: it patches dsh-base's `agent-instructions` row (`src/instructions.ts`,
in layer 6 beside the persona key) the way the persona patch does, spreading
the config the layers below left and applying `GRAVIT.md` and
`GRAVIT.local.md` last. So every agent in the tree reads `GRAVIT.md` and its
machine-local twin `GRAVIT.local.md` (gitignored at the repo root) in each
directory from the repo root down to the session's cwd, and no other name —
`AGENTS.md` and `CLAUDE.md` are the coding agents' files — except the
user-global `$DSH_HOME/AGENTS.md`, a name dsh hard-codes, which still loads
if you keep one. As with the persona key, everything else of yours on that row
survives — `projectRootMarkers`, `maxSourceBytes`, `maxBytes` — and so does
`disabled`; only the two candidate lists are overridden, and the patch file's
header says so.

The research cycle is the face's too: `../dsh/profile/cycle.md`, the one file that tells Gravit
how to run a cycle — one batched question, then a goal of at most 24 rounds to a verdict, in which
Gravit reads the Account through its seat (AKShare among its reads) and trades forward on the paper venue (no
role calls, nothing backtested). It is not a patch on a dsh-base row but a key of the default
preset: `composeFace` reads it beside `../roles/` (`readCycle`, `src/cycle.ts`) and hands the text
to the preset's `gravit` row as `cycle`, which `plugins/gravit.js` mounts as the `gravit:cycle`
prompt section, after every tool section and just before the persona suffix, with `interpolate:
false` (a brace in the file is literal). The section's text is the file when the assembling scope
can call `create_goal` AND the session is a root or a fork (`isRootOrFork`: no `origin`, or
`origin: subagent` with `isSeeded`), and empty otherwise, so it reaches Gravit's sessions and a
`subagent_fork` child's — the same text in both — and no one else: a plain `subagent`, workflow or
ralph child can call `create_goal` but is a delegated child that is not a fork, a role child's
allow list can never name a goal tool, and a bot is another preset. The roles section ("Roles"
below) is gated the same two ways. A missing, unreadable, empty or oversized file (over 3,300
bytes, counted raw) refuses the boot, naming the file's absolute path first. After an edit run
`npm run render:roles` — the mirror `bots/gravit/agent.cordis.yml` embeds the text, and
`tests/roles.test.ts` fails while the two differ — commit both and restart the face; nothing
reloads it while the face runs. The gate is silent when the tool goes away: a profile patch that
disables dsh-base's `tool-goal` row makes `create_goal` invisible, and the section then vanishes
from Gravit's prompt with no warning (disabling `goal-round-driver` leaves the section in place
and re-prompts nothing). "The cycle drill" at the end of this file is the live check.

The desk's contract is the face's the same way: `../dsh/profile/desk.md`, the
one file that tells Gravit how to behave on the desk ("The desk" below) — it
informs and never orders; a question is a line in its message; every number
names its source and time; it never writes the four control files or an
instruction file. `composeFace` reads it beside the cycle (`readDesk`,
`src/cycle.ts`: refused for the same faults, path first, over the same 3,000
bytes), and `bootFace` declares the `gravit-desk` preset with it
(`src/desk-preset.ts`), whose `gravit` row mounts it as the `gravit:desk`
section in the cycle's slot — for a root session or a fork, with no tool gate.
A preset carries one contract or the other: Gravit's the cycle, the desk's the
desk, and `plugins/gravit.js` refuses a row with both. No mirror embeds it;
restart the face after an edit.


## The policy layer (src/policy.ts)

dsh-base 0.2.0 changed several product defaults that decide what Gravit can do
and what leaves the machine. The face restores the 0.1.1 posture in one
reviewable file, composed directly above the bundle layer and BELOW the
operator's layers — so, unlike the overlay rows, each of these is a default the
operator overrides with one same-id row (three for `web_fetch`) in
`$DSH_HOME/profiles/face/cordis.patch.yml` (`tests/policy.test.ts` pins that an
operator row wins). Every row is an upgrade decision, named by its id:

| Decision | dsh-base row | The face's default (0.1.1 parity) | dsh-base 0.2.0 default | Following upstream instead |
|---|---|---|---|---|
| D3 session telemetry | `session-telemetry-otel` | disabled | `FEEDBACK_ONLY`: after a `/feedback`, a session-log prefix goes to `dsh-otel-collector.deepseeksvc.com` with the home's `.anonymous-user-id` | `- { id: session-telemetry-otel, disabled: false }` (D15; `DSH_TELEMETRY_DISABLED`, when set, still wins) |
| D4 session-log upload | `session-log-deepseek` | disabled | up to 8 MiB of session events in every official DeepSeek request (`dsh_session_log`) | `- { id: session-log-deepseek, disabled: false }` |
| D5 package inventory | `plugin-package-inventory-deepseek` | disabled | the active plugin-package list in every DeepSeek request | `- { id: plugin-package-inventory-deepseek, disabled: false }` |
| D6 `web_fetch` | `tool-web`, `web`, `web-fetch-http` | `tool-web: {fetch: false, searchTimeoutMs: 60000}`, `web: {searchProvider: deepseek-official}`, `web-fetch-http` disabled | `web_fetch` on, served by `web-fetch-http` | `- { id: tool-web, config: { fetch: true, searchTimeoutMs: 60000 } }`, `- { id: web, config: { searchProvider: deepseek-official, fetchProvider: http } }` and `- { id: web-fetch-http, disabled: false }` |
| D7 MCP resource tools | `mcp-resources` | disabled | `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource` and a prompt section, once any MCP server registers | `- { id: mcp-resources, disabled: false }` |
| D9 `ralph` | `tool-ralph` | enabled (`disabled: false`; dsh-base's config kept) | disabled | `- { id: tool-ralph, disabled: true }` |
| D9 `str_replace_editor` | `tool-str-replace-editor` — dropped from dsh-base; the face inserts it, configless (`maxOutputChars` now defaults to 0.1.1's 16000) | mounted | absent | `- { id: tool-str-replace-editor, disabled: true }` |

Two patch rules decide how such rows are written: a row that names `config`
replaces that row's WHOLE config (hence D6's configs written out in full), while
`{ id, disabled }` keeps it. A policy target missing from the bundle — a row
renamed upstream — is reported on stderr at boot (`gravit-face: warning:
policy D…: dsh-base composes no "<id>" row …`), never skipped silently.

The effect is measured, not assumed: on a profile with no MCP server the live
tool roster equals 0.1.1's name for name (26 tools), and the smoke asserts that
`str_replace_editor` and `ralph` are registered while `web_fetch` and the three
MCP resource tools are not. Turning `web_fetch` on opens a new outbound path
for the model, with no guard on what it reads; the shipped bot allow list
(`DEFAULT_ALLOW`, `src/bots.ts`) does not name it, so voices stay without it
either way.

### Every decision the upgrade defaulted

The upgrade to 0.2.0-rc.2 was planned around decisions D1–D18 — the ids the
code comments cite as "PLAN D…". The charter and the design specs number their
own decisions in separate series (the persona's D11, the bots spec's D12 for
read-only room members), so this file says "upgrade decision" where it means
these. Each has a default in the code and is the operator's to revisit:

| Id | Default | Where |
|---|---|---|
| D1 | No `profileContext`: no settings service (`settings/describe` has none), `$DSH_HOME/settings.yaml` unread, no config editor, plugin manager or `dsh-hmr` | `src/boot.ts` header, divergence 2 |
| D2 | Default model = the profile's `agent-default-model` row, else `deepseek-official/deepseek-flash` | above |
| D3–D7, D9, D15 | The policy rows | above |
| D8 | No browser cookie outside `/` and `/api`: `/data/*` keeps only its loopback fence (the `/market` and `/account` pages it also covered left with stage 2) | "Sign-in" |
| D10 | No HTTP proxy policy | "Run", env table |
| D11 | Pre-0.2 room logs stay on disk untouched; a legacy member session becomes that member's failed turn | "Sessions written before 0.2.0" |
| D12 | The 0.1.1 CLI and the pre-upgrade face do not run on a home 0.2.0 has written — an operator practice, not code | "Upgrading dsh" |
| D13 | `$DSH_HOME/profiles/node_modules`, the 0.1.1 link farm, goes once D12 holds — the operator deletes it | "Upgrading dsh" |
| D14 | The face never un-archives a host archive (409) | "Channels" |
| D16 | A cold session opens page-only, never activated by a view | "The wire and the transcript" |
| D17 | Three descriptor-v2 subagent children and one seq-gap log stay unreadable on disk, like D11 | "Sessions written before 0.2.0" |
| D18 | The tool-result spill budget stays at dsh-base's `maxInlineTokens: 12500` | "Tool results" |

## Markets and Account

The rail opens **Markets** (`#/markets`) — the Account's markets by its own tabs, China (the A
shares, read from the Account like every market) among them — and **Account**
(`#/account/portfolio`, `money`, `venues`, `agents`, `cards`, `rules`), the Account's wallet half.
The Account serves no page (since 2026-11-01): these screens and Trade are its only page. Both read the Account through the face's proxy ("The Account in
the face" below): market data comes the Account's way — keyless, server-side at the Account, read
by what the page is looking at, one push channel per tab — and every figure on either screen is
the Account's, A shares included. Both are screens of the client at `/` since stage 2 of
route A; the old `/market` and `/account` pages are gone, and their addresses answer 404. Gravit
orders through the seat's tools, behind Gate 2 and the Account's own card. Since 2026-10-24 the
operator orders by hand too: the face's page can be one of the Account's owner devices, and while
it signs, **Trade** (`#/trade`, the rail's item after Markets) places and cancels the operator's
orders, a market's page carries Buy and Sell, a star on an Account market signs the Account's own
watch list, and Account carries the owner's keys — each signed in this browser at the Account's
door, never by the face ("The Account in the face" below). While the page does not sign, those
keys are absent, not disabled, and the device line under the Account head says why.

### Markets

One table under the search box (`Search markets`). Its tabs are the Account's: **All**, then
**Crypto · Stocks · RWAs · Perps · Pre-IPO · Predictions** where the Account lists something
— each with the Account's count once All's read has answered, All counting the starred A shares
too (Stocks is the Account's alone) — then **China**, the Account's own tab, then **Watching** last once
anything is starred, with **All results** first while searching;
a tab starts from Most traded. With two or more rows, the sorts **Most traded · Biggest moves**,
and **Closing soonest** where a row closes: Most traded ranks the Account's rows by their volume
(a Kalshi row's contracts by their number), then the A shares by turnover (China's rows, in yuan); Biggest moves by the
size of the 24-hour move; Closing soonest by the close; a row without the figure sorts last.

A row: the star (`Watch BTC` / `Stop watching BTC`); the tile — the face's own letters, never an
image the Account names — and the name over its sub (a coin's base, a stock's venue, a
perpetual's base, an event's category, `Pre-IPO · Perpetual`), tagged `Closed` past its end and
`Paper` where only a paper account trades it first; the price now, in its unit (`$63,226.60`, an
event in cents `62¢`, an A share in yuan `¥1,688.00`) — the latest quote at the row's most traded
connected line where the quotes poll or the stream has one, else the explore read's; the 24 hours
(an arrow, `up` or `down` for a screen reader, the percent, an event's move in cents); the volume
(`$1.9B`, `412k contracts` for Kalshi, `2M shares` for an A share); and **Source**, where the
price is from in the Account's own words (`Robinhood · real time`, `Cboe · 15 min delayed`), with
its age once it is more than five seconds old (`· 2 min ago`). Missing values stay em dashes.

With a query the rows are the Account's search, its A-share hits among them (`N markets for “q”`,
and Clear). With no rows the table says `Nothing watched yet` (Watching), `No markets` for an
answer with none, `Loading…` or `Searching…` while a read is on its way, and `Markets
unavailable` (`Search is unavailable` while searching) when the read failed before it ever
answered. The muted lines say what is going on and nothing else: the Account's own sentence when
the read the rows are from refused (the rows read before it stay); the search's `Search
is unavailable` or `Some results may be missing` (the Account's answer names China among what is
missing when Tencent did not answer); the watchlist's trouble (`Couldn't save the watchlist`, `The watchlist is full`, `Couldn't read the
saved watchlist`).

**China** (specs `docs/superpowers/specs/2026-10-31-china-tab-design.md` and
`2026-11-01-account-two-parts-design.md` §4) is the day's top 20 A shares from Tencent's ranking,
the Account's `explore?tab=china&sort=` through the face's proxy: **Most traded** by turnover, **Biggest moves** by the size of the day's
change, gainers and losers together. Its count is every A share the ranking lists (`China ·
5,577`, Beijing listings included); its headers read **Today** and **Turnover**. A row: the star
(the Account's watch list, like any row), a tile with the name's first character, the name over `<code> · <board>`
(`SH`, `SZ`, `ChiNext`, `STAR`, `BJ`), the price in yuan, the change against the previous close,
the turnover (`¥216.08亿`) and `Tencent`. It is read when China comes on screen and every 20 s
while it stays, nothing otherwise; a muted line says `Closed · 10-30 15:00 Beijing` or `Midday
break · 11:30 Beijing`, and `Couldn’t refresh China` over the rows kept when a read fails
(`China unavailable` with none). No row shows while the ranking for another sort is on its way.

The stars are this browser's, in one store — the Account's row keys (`coin:BTC`, `stock:AAPL`,
`event:<venue>:<market>`, `cn:600519`, …) under `gravit.account.watch.v1` — plus the old face list
under `gravit.market.watchlist.v1`, whose A shares move into the first store once, unsigned, and the key the old page wrote (a browser that saved before the
2026-10-08 rename keeps its list too: `kairos.market.watchlist.v1` is read while the new key is
absent and never written or deleted) — at most 100 each, in step across same-origin tabs through
storage events, never synchronised across devices. An old `us:` or `crypto:` star on the face's
list is asked of the Account once per boot (`explore?q=<symbol>`, a coin by its base): found, it
is the Account's row, starred, and moves to the Account's store; not found, it is listed once as
`Not listed at the Account`, with **Remove** in place of its star; a read that fails asks again on
the next boot. A starred market no read lists is drawn `Not in this read` and can still be
un-starred; neither opens a page. On a page that signs for the Account, a star on an Account row
is the Account's own watch list instead — the one Gravit's seat reads: one press signs
`setWatch` at the market's line (no sheet, as the retired page did), taken it reads the Account again
and the star follows it, refused the Account's sentence is the watchlist's words; un-starring signs
the Account's entry off and takes the key off this browser's store too. **Watching** is then both
lists at once.

While Markets is on screen in a visible tab it reads the tab on screen at once and every 20
seconds, and every 5 seconds the quotes of the rows drawn (on a market's page, its own market's),
twelve markets a call; the search reads
once the box has been quiet for 300 ms. Another screen or a hidden tab stops both ("The Account in
the face" has every read).

The A shares are the Account's like every other market (since 2026-11-01; `DEVELOPMENT.md` §3.9
"China"): the ranking is `explore?tab=china&sort=volume|movers`, the search is the same `explore?q=`
(Tencent's smartbox, merged with the other markets' hits, so there is no second read), the prices and
the page's facts are `quotes?pairs=china|<code>`, the history is `candles?venue=china`, all through
the proxy and its allow-list. China has no push channel, so these are polled with the rest (5 s for
the prices). The face holds no market wire of its own: it serves no `/data/quotes`,
`/data/symbols/search` or `/data/cn/*` (none is served), reaches no market host, and has
no `FACE_QUOTE_POLL_MS`; `tests/no-market-hosts.test.ts` pins it. A `cn:` id is an Account key
(`cn:` and six digits); a `us:` or `crypto:` star left on the old list is asked of the Account once
per boot, as before. The Account reads Tencent's public hosts (no account, no key); a row's
`Tencent` source and the page's state lines are the Account's own words.

Once the Account has answered for China (a ranking or a quote read), Account › Venues'
`A-share quotes` line reads its state in the Account's own sentence — `Tencent · answering`,
`Tencent did not answer · China as of hh:mm Beijing` when its read is stale, `Tencent is not
answering: A shares cannot be read now` when it has none — falling back to the face's
`Tencent · Connected` / `Limited` / `Error` only when the Account said nothing; while the proxy
re-serves the Account's last read (the Account not answering) it reads `The Account is not
answering · China as last read`, as the China tab and Watching do, and an A share's page says
`The Account is not answering · as of MM-DD HH:MM Beijing` over its last price, never Delayed or
Closed; before any China read it is not drawn. Event timestamps are Tencent's own — its quote's last update, which can run
past the close (16:14 for a 15:00 close on 2026-10-30) — read as Beijing time, and receipt time
never fills a missing one. Volume is in shares: Tencent counts lots of 100 on most boards and shares on
STAR (measured 2026-10-30), so each reply's own turnover decides the unit, and a reply no unit fits
leaves the volume unknown. `Live` means the trade time is under five minutes old, the hub's rule
whatever the provider; whether Tencent reaches this machine without delay during a session is not
yet measured. Tencent's own words are Chinese and never reach the screen; every word is drawn from the
Account's enums and sentences. Until 2026-10-30 the iFinD QuantAPI quoted the A shares, with a token
and a monthly quote quota; nothing in the face reads `IFIND_*` now — only the Account does, for the Lunhui boards
stand-in ("Lunhui analysis").

### A market's page

`#/markets/<key>` — a row's name opens it, and a pasted link works too: an Account key is kept
whole (`#/markets/coin:BTC`), a face id canonicalised (`#/markets/cn:600519`), an id that is
neither opens Markets, and a key no read lists yet draws Markets until a read lists it. The head:
the tile, the name, its sub (the kind and the symbol at the line the page follows, `Stock · NVDA`;
an event's category and when it closes), `Closed` past its end; on a page that signs, for a coin,
a stock, an RWA or a prediction (never a perpetual or a pre-IPO contract), **Buy**, and **Sell**
where something of it is held — each opens Trade on the market with the ticket on that side;
**Hand to Gravit** — a new message in the root channel with `Look at <base> (<name>)` in the
composer — **Watch** / **Watching**, and for a perpetual, on a page that signs for an Account that
takes writes where a venue sets leverage from here, **Leverage…**.
Then the price now (the stream's quote for the market the page follows, else the quotes poll's,
else the explore read's) with the explore read's 24 hours, an event's outcomes in cents under it
(`Yes 62¢`, `No 38¢`), where the price is from with its age, and the facts **24h volume** and
**Venues**.

- **Price history** — the Account's ranges **1D · 5D · 1M · 3M · 6M · YTD · 1Y · 5Y · MAX** (1D
  until one is chosen, kept per market): the closes of the Account's candles at the line the page
  follows, as an area and a line with the first and last bars' times on the axis, the low and the
  high, and the Account's own words under it; `Loading…` while a range not drawn yet is read, `No
  history` for an answer with fewer than two closes, the Account's sentence (else `History
  unavailable`) over a failed read, the closes kept for the range while it is read again.
- **Across venues** — the market's lines, the ones the owner connected first, each with its price;
  `Best` on the lowest ask among the lines that take an order now, `Paper` where so; a public
  listing with **Connect to trade**, a link to Account › Venues.
- **You here** (since 2026-11-01, from the Account's asset sheet, `asset?key=`) — the venues it
  could not read, the holding, the positions with their cost and, on a page that signs for an
  Account that takes writes, **Close…** (**Sell…** for a stock or an event) and **Leverage…**; the
  owner's open orders with **Change…**; under `What agents do here` a line per agent order working
  here, with its Change…, or a statement line by them (`You don’t hold any.`).
- **Order book** (`book`) — ten levels a side, best first, bids beside asks, whose book in its
  words, `Top of book` for the best bid and ask alone; **Latest trades** (`trades`) — twenty, newest
  first, or the Account's sentence when the source publishes none; a perpetual's **Funding**
  (`funding`) — paid and received hour by hour, `None yet.`.
- **Gravit on it** — the conversations whose titles name it (its base, or an event's name), as
  links, when there are any; **On the statement** — the statement's lines naming its base or one of
  its symbols, `✓` on a filled or settled one, and `Open the Statement →` (`Nothing on the statement
  about it yet.`).

Each part says `Loading…` until its own read has answered, its own `… unavailable` (`Account
unavailable`, `Order book unavailable`, `Trades unavailable`, `Funding unavailable`, `Statement
unavailable`) — under the Account's sentence when it gave one — when that read failed before any
answer, and keeps what it read under a later refusal's sentence. Close…, Change… and Leverage… are
the owner's keys ("The owner's keys" below), each prepared and signed in What you sign.

Opening the page reads the candles for its range, the Account's compare rows for a coin's, a
perpetual's or a stock's base (kept in the store; no screen draws them yet), the holdings and the
statement, the asset sheet (`asset`), a perpetual's `funding`, and the `book` and `trades` at the
line it follows (the trades no more once the source said it publishes none); follows its line on the tab's stream — its first connected line, else its first public
listing, one `<venue>:<symbol>` told to `stream/markets` — and puts its own market's most traded
connected line, when it has one, in the 5-second quotes poll, taken from the page's own view when
the market is no row of the tab on screen (a deep link, Back onto another tab). Leaving lets the
market go.

A `cn:` page is the Account's quote and history: the tile with the name's first character, `A-share
· 600519 · SH`, the price in yuan with the change against the previous close, and a state line in
Beijing time — `Tencent · Live`, `Tencent · Delayed · 09:41 Beijing` for an open market's old quote,
`Tencent · Midday break · 11:30 Beijing`, `Tencent · Closed · 10-30 15:00 Beijing`, or `Quotes
unavailable` while the Account cannot read Tencent. Then twelve facts from the same quote — Previous close, Open,
High, Low, Turnover (`¥82.57亿`), Turnover rate, Market cap (`¥1.74万亿`), P/E (TTM) (`−12.50` for a
loss), Limit up, Limit down, Volume (`599万股`), Amplitude — and **Price history** through the Account's
`candles?venue=china`: 1D the session chart (09:30–15:00, the previous close dashed), 5D the five
sessions on one grid, 1M to MAX forward-adjusted closes on Beijing dates. Gravit on it as before;
no venues, no Buy or Sell.

### Account

The Account's read (`/data/account`, its `GET /api/account`) is read at boot — the rail's line
under Account is its leading figure once it answers (`· Paper` when Paper leads), beside a badge
counting the cards waiting — on entering Account, every 20 seconds while Account is on screen in a
visible tab (80 while the tab's stream is open), on **Refresh** and right after a streamed receipt,
the seat's too (those two `?fresh=1`, past the proxy's 15 seconds), and on the stream's events. The
head: `Account`, the Account's mode and writes as chips (`Guard` or `Beast`; `Trading on · $250 a
move` or `Read-only`) — changed under Rules, the writes only by how the Account was started — then
Refresh and Settings; under it the device line (whether this page signs for the Account, "The
Account in the face" below); the Account's refusal sentence, when it gave one, as a muted line. Six
tabs — **Portfolio · Money · Venues · Agents · Cards · Rules** (`Cards · N` while cards wait) — and
two drawers. The keys marked *(signs)* below are drawn only while this page signs (absent, not
disabled: the device line says why); the Market half's and Money's keys also only for an Account
that takes writes:

- **Portfolio** (on entering it the holdings, then the curve): the leading figure with its label
  and the second beside it, smaller — **Net worth** (the Account's `totalUsd`, real money) leads
  unless it is zero while a paper venue is connected and the paper book has a total, when
  **Paper** leads; the change for the range in one line — the dollars and the Account's percent,
  the range, `partial`, since when on All, and on the paper curve what it made since its start and
  `rebuilt`; the range seg **1D · 1W · 1M · All** and the leading figure's curve; the venues a
  read could not reach (`<venue> did not answer`); **Assets** — each asset across its venues,
  Asset · Amount · Price · 24h · Value, with **Sell many…** over the table and an earning row's
  **Take out…** *(signs)* — and **Positions** — Position · Value · Entry · Mark · P&L, `Paper`
  where so, each row's **Close…** (**Sell…** for a stock or an event) and a perpetual's
  **Leverage…** where its venue sets it *(signs)* — both the leading lens's; **Open orders**
  (open, partial, pending), each with whose it is (`You`, `Agent · <name>`, `An agent`); the
  **Statement** key. `Loading…` before the first answer, `Account unavailable` with Retry when it
  failed before any, `Account unreadable` for an answer the face does not recognise — never a
  number from it; a failed read after a good one keeps the figures, stamped `As of 14:32 · stale`,
  with Retry, and a read the Account itself says is stale carries the same stamp. Where Assets
  would be: `Holdings unavailable`, or the Account's sentence when the holdings read refused.
  **Sell many** is a drawer: up to ten holdings, each its own order at market and its own
  signature, reviewed (`Review <n> sales`) then signed leg by leg (`Sign <n>`).
- **Money**: **Receive** — `Send only the asset on the network the row names: anything else may
  not arrive.`, a row per account and network with **Show address** (then the address, its memo
  where one is needed, **Copy**, **Read again**); **Move** — each account money moves from, with
  **Move…** *(signs;* `Sign and move`*)*, or on a read-only Account `Read-only: the Account was
  started without trading, so it moves no money.`; **Earn** — each product's venue, amount and
  yield with **Take out…**, and **Put in…** *(signs)*; **Waiting for your wallet** — the payments
  the Account built for the operator's own browser wallet, with **Send from wallet…** or **Report
  again**.
- **Venues**: each venue the Account connected — its value, front line and what it trades, its
  health (`Answers`, `Not answering since 14:02`, `Not read yet`), what it does (`Trades`, `Moves
  money`, `Receives`, `Earns`), `Paper` or `Closed to agents`, stale — with **Details**, a drawer
  of what it holds there and the Account's facts (`No trading`, `Restricted`, `Not served`, `Close
  only`, `Watch only`, `Key file` by its path, never what is in it; a paper venue's **Top up** and
  **Start over** *(signs)*), **Close to agents** (unsigned, on any page that reads the Account: the
  safer direction) or, closed, **Reopen…** *(signs)*, and **Disconnect…** *(signs;* asked in place,
  `Yes, disconnect`; none on an agent wallet, and the Account refuses while an order or a payment is
  open there*)*; under the list **Connect an account** — every kind the Account connects: a key
  file, a browser wallet (**Use <wallet>**, its challenge signed in the wallet), a venue's sign-in
  (**Sign in at <venue>**, finished through the face's `signin/callback`), an address, the
  command-line connector — and **Open a paper account** *(signs)*; under them, once the Account has
  answered for China, `A-share quotes` with the Tencent provider's state; then the **Account seat**
  box (`/data/seat.json`, read on entering Venues or Agents, on Refresh, right after a seat receipt
  and on a card raised or answered): the service reachable or not with the Account's own mode and
  writes (`Guard · Trading on · $1 a move`), the seat (`Gravit · admitted until Nov 19`, `Gravit ·
  knocking — let it in under Account › Agents`, `not on the account`, `expired`, `revoked`) with
  each limit (`trade · paper-1 · $100 an order · $850 of $1,000 left`), the venues with a `Paper`
  chip on the paper ones, `N cards waiting`, the stamp, Refresh, and **Answer under Cards** while
  cards wait.
- **Agents** (on entering it the Account's agents and the seat): Gravit's seat first, in the seat
  box's words, with its limits and the counts of its cards waiting and its open orders (`—` until
  the agents are read) — while admitted **Give a limit…**, **End limit…** and **Revoke…**, while it
  knocks **Let in…** *(signs)* — then every other agent with its status, until when, its limits and
  counts, each with **Give a limit…** (every scope: trade, venues, payees, earn), **End limit…** on
  each standing limit, and **Revoke…** (asked in place, `Yes, revoke`; final for that address)
  *(signs)*; under **Knocking** the keys asking to be let in, each with **Let in…** *(signs)* — let
  Gravit's in under the name **Gravit**, which is how the seat box finds it. **Agent wallets**
  under them: each wallet's name, whom it pays for, its address and what it holds, with **Top
  up…** and **Take back…**, and **Open an agent wallet…** while a key is let in *(signs)*.
- **Cards** (the tab counting what waits; on entering it the read past the cache): **Waiting for
  you**, grouped by agent — each card's reason, value and the time to answer by, and **What it
  asks**, every field the owner signs, as the Account sent it — with **✓ Approve** and **✗ Reject**
  *(signs;* one card, one signature, no approve-all*)* — and the agents' **Asks** under them, each
  with **Grant** (every kind: a limit, a venue, a key, a top-up, a session, leverage, the mode —
  each opening its form) and **Decline** *(signs)*. On a page that does not sign the cards are
  read, not answered: an owner device answers them.
- **Rules**: **Mode** — the Guard · Beast seg, the lead `Guard: what agents ask for waits for you on
  a card. Beast: inside the limits you signed, it goes at once. Guard is one click; Beast is
  signed.`, `Beast removes the Account's card only: Gravit's orders still raise their Gate 2 card
  in this face first.`, and the table of what each mode does door by door; Guard is one click and
  unsigned on any page that reads the Account, Beast a signed sheet (`Sign Beast`), `Only a browser
  that signs switches to Beast.` on a page that does not. **Each move at most** (the cap,
  **Change…**, `Sign the cap`), **Agents' session** (`Agents may act until <date>.`, **Renew for
  30 days** or **Start a new one**) and, where a venue sets leverage from here, **Their leverage**
  (`Up to <n>x on a perpetual, …`, **Change…**, `Sign leverage`) *(signs)*; on a read-only Account
  each of the three says `Read-only: the Account was started without trading, so there is no …`.
- **The Statement** (a drawer, its lines read on opening it): the Account's lines newest first,
  each with who it was by, its status in the Account's word and its fee; **Export CSV** — a
  `statement.csv` built in the browser (`date,type,kind,description,amount,fee,status,by`; a text
  cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is led by an apostrophe);
  `Loading…`, `No statement lines yet`, `Statement unavailable`, the Account's sentence over the
  lines kept after a refusal.
- **Settings** (a drawer on every screen): the theme, and **Devices** — the Account's owner devices
  by label, this page's marked `this page`, the browsers waiting to be let in, with **Let it sign**
  and this page's **Sign out** *(signs;* in Beast it offers `Switch to Guard first: whatever an
  agent asks for waits for a signature`, ticked for the last device that signs*)*.

Not on the face, by the design (`../docs/superpowers/specs/2026-11-01-account-two-parts-design.md`
§5.4): the Account's own Superagent (the Desk and its Brains), Intents and Memory — their server
code and seat tools stay in `../account/`; nothing on the face draws them.

## The Account in the face (src/account-proxy.ts + client/js/wire/account-stream.js)

Since 2026-10-22 (stage 1 of `../docs/superpowers/specs/2026-10-22-account-graft-design.md`) the
Markets and Account screens read the Account — the service the seat sits at ("The Account
seat" above) — through the face. The Account answers only a bare loopback request: its fence
refuses a page at another origin, the face's included, so the page never asks it. The page asks
the face, under `/data/account…`, and `src/account-proxy.ts` asks the Account with a plain
loopback fetch — no `Origin`, no `Sec-Fetch-Site`, no cookie, `redirect: "error"` — at the URL of
the `mcp-account` row as composed (`FACE_ACCOUNT_URL`, default `http://127.0.0.1:4820`, unless a
patch moved it). A disabled seat row disables the proxy too: every valid read answers
`503 {"ok":false,"unreachable":"disabled"}` and asks nothing. The face vendors nothing of the
Account, holds no key, signs nothing, and logs nothing of a body, a query or a frame. Since
2026-10-24 (stage 2) the proxy also carries the owner's three writes, and the page — this
browser, not the face — can be one of the Account's owner devices ("The owner device" below).
Since 2026-11-01 (plans 4a and 4b of `../docs/superpowers/specs/2026-11-01-account-two-parts-design.md`)
it carries both halves the Account's retired page carried — the Market half's reads and the wallet
half's writes — and a venue's sign-in callback, and the Account serves no page of its own: this
face is its only page.

Each route is `exact` — the table is the allow-list, and nothing else of the Account's surface is
reachable through the face (thirty-eight routes: twenty-three reads, the push channel's two,
twelve writes, the sign-in's callback):

| Route | What it reads at the Account | TTL | Abort | Query names |
|---|---|---|---|---|
| `GET /data/account` | `GET /api/account`: the Account's read — venues, health, cards, orders, keys, signers, the mode and writes | 15 s | 7 s | `fresh` |
| `GET /data/account/explore` | its markets, by tab, or a search | 20 s | 10 s | `tab`, `q`, `key`, `sort` (China's ranking), `limit` |
| `GET /data/account/market` | one market at one venue | 3 s | 7 s | `venue`, `symbol` |
| `GET /data/account/quotes` | the latest quotes of up to twelve markets | 3 s | 7 s | `pairs` (2,000 characters) |
| `GET /data/account/compare` | a base's prices across venues | 15 s | 7 s | `base`, `side`, `usd`, `asset` |
| `GET /data/account/candles` | a market's price history | 30 s | 25 s | `venue`, `symbol`, `interval`, `range`, `before`, `limit` |
| `GET /data/account/holdings` | assets and positions across venues; `paper=1` the paper book's | 8 s | 12 s | `cost`, `paper`, `fresh` |
| `GET /data/account/positions` | positions | 10 s | 7 s | `venue` |
| `GET /data/account/statement` | the statement's lines | 10 s | 7 s | `fresh` |
| `GET /data/account/history` | the worth curve; `paper=1` the paper book's | 60 s | 12 s | `range`, `paper`, `venue` |
| `GET /data/account/agents` | every agent the Account knows, with its limits | 15 s | 7 s | `fresh` |
| `GET /data/account/stream` | the push channel (server-sent events), one upstream request per browser connection | — | — | `client` (required), `since`, `markets` (4,000 characters) |
| `POST /data/account/stream/markets` | the markets a stream follows | — | 7 s | none |
| `GET /data/account/venues` | every venue the Account knows, with where this account can connect it (stage 2) | 60 s | 30 s | none — never the Account's `force` |
| `GET /data/account/connect/reach` | whether a connector answers from where the Account runs (stage 2) | 5 s | 30 s | `connector` |
| `GET /data/account/keyfile` | whether a key file is there and which fields it has — a path and names, never a value (stage 2) | 5 s | 30 s | `kind`, `venue`, `ref`, `exchange` |
| `GET /data/account/paper/books` | the paper books kept on the Account's disk and not connected (stage 2) | 5 s | 30 s | none |
| `GET /data/account/asset` | a market's asset sheet: what the owner holds of it, its orders, its lines and cost, the agents' activity (the two parts) | 5 s | 25 s | `key`, `interval`, `range`, `fresh` |
| `GET /data/account/book` | a line's order book (the two parts) | 2 s | 7 s | `venue`, `symbol`, `depth` |
| `GET /data/account/trades` | a line's latest trades (the two parts) | 2 s | 7 s | `venue`, `symbol`, `limit` |
| `GET /data/account/funding` | a perpetual's funding, paid and received (the two parts) | 60 s | 12 s | `venue`, `limit` |
| `GET /data/account/receive` | an account's address to be paid at (the two parts) | 60 s | 30 s | `venue`, `asset`, `network` |
| `GET /data/account/earn` | what is earning and where it can (the two parts) | 15 s | 30 s | `venue`, `asset`, `fresh` |
| `GET /data/account/sellable` | what Sell many can sell (the two parts) | 5 s | 30 s | `fresh` |
| `GET /data/account/signin/status` | where a venue's sign-in stands (the two parts) | 1 s | 7 s | `state` |
| `POST /data/account/pair` | `POST /api/account/pair`: this page's public key, its label and the code (stage 2) | — | 7 s | none; at most 4,096 bytes |
| `POST /data/account/prepare` | `POST /api/account/prepare`: a draft prepared, unsigned (stage 2) | — | 30 s | none; at most 16,384 bytes |
| `POST /data/account/exchange` | `POST /api/exchange`: the signed envelope (stage 2) | — | 30 s | none; at most 65,536 bytes |
| `POST /data/account/wallet/challenge` | `POST /api/account/wallet/challenge`: a browser wallet's challenge, built on the face's origin (the two parts) | — | 7 s | none; at most 1,024 bytes |
| `POST /data/account/wallet/prove` | `POST /api/account/wallet/prove`: the wallet's signed challenge (the two parts) | — | 12 s | none; at most 2,048 bytes |
| `POST /data/account/signin/start` | `POST /api/account/signin/start`: a venue's sign-in, its redirect on the face's origin (the two parts) | — | 30 s | none; at most 512 bytes |
| `POST /data/account/bridge-routes` | `POST /api/account/bridge-routes`: a move's routes between chains (the two parts) | — | 30 s | none; at most 4,096 bytes |
| `POST /data/account/live/order-sent` | `POST /api/account/live/order-sent`: the browser wallet reports what it sent for an order (the two parts) | — | 30 s | none; at most 512 bytes |
| `POST /data/account/live/order-requote` | `POST /api/account/live/order-requote`: such an order quoted again (the two parts) | — | 30 s | none; at most 512 bytes |
| `POST /data/account/live/sent` | `POST /api/account/live/sent`: the browser wallet reports a payment sent (the two parts) | — | 30 s | none; at most 512 bytes |
| `POST /data/account/revoke` | `POST /api/revoke`: Close to agents, unsigned (the two parts) | — | 7 s | none; at most 512 bytes |
| `POST /data/account/guard` | `POST /api/mode`: Guard, unsigned — the face always sends `{"mode":"guard"}` (the two parts) | — | 7 s | none; at most 256 bytes, then discarded |
| `GET /data/account/signin/callback` | `GET /api/account/signin/callback`: where a venue sends the browser back after its sign-in (the two parts) | — | 30 s | `state`, `code`, `error`, `error_description`, `error_uri`, `iss` |

The screens read twenty-one of the twenty-three reads; `market` and `positions` are proxied and
read by no screen yet. The writes follow `stream/markets`' rules: a body declared `application/json`
(else 415) on a bare path (any query name is 400), at most the row's bytes (413), forwarded as the
text it came as with `content-type: application/json` — never parsed, kept, logged or echoed, so
the pairing code and a signed envelope pass through the face once and leave no trace in it — and
the Account's status and body come back as they are, never kept and never served stale (a fetch
failure is `503` with its code; a disabled row `disabled` once the body is read). Two writes
differ: `guard` reads its body under its limit and sends the fixed `{"mode":"guard"}` whatever came,
and `wallet/challenge` and `signin/start` alone carry `x-gravit-face-origin`, the face's origin as
the browser reached it (built from a loopback `Host` alone), on which the Account builds the wallet
message's domain and the sign-in's redirect — the Account refuses a `signin/start` without it.
`revoke` and `guard` are the two unsigned writes: each makes the Account safer, the direction the
Account itself takes unsigned.

**The sign-in's callback** is the one route a page navigates to from elsewhere: a venue's sign-in
page sends the browser back to `/data/account/signin/callback`. It has its own fence — a loopback
`Host`, a GET top-level document navigation, no `Origin`, any `Sec-Fetch-Site` (the venue's page
sends `cross-site`) — else 403; every other route still refuses that navigation. Its query is
rebuilt from the six names above, each at most once and within its bound (else 400), forwarded to
the Account, cut at 30 s, never kept, never stale; the Account's HTML answer comes back under a
content-security-policy that runs no script, loads nothing, posts no form and is framed by no one.
An Account that does not answer, or a disabled row, is 503 with `The Account did not answer. Go
back to Gravit and start the sign-in again.`

The rules, in order. The `/data` fence first (`403 {"ok":false,"error":"forbidden"}`), then 405
for a method the row does not name, then the query rebuilt from the row's names in the order they
came — each name once, each value at most 240 characters decoded (`pairs` and `markets` their own
bounds), the request target at most 8,192 — or `400 {"ok":false,"error":"invalid account
request"}`, and the Account is never asked; the raw query never reaches it. `fresh=1` is the face's
own flag, never forwarded: it skips the TTL and never joins a plain read in flight — it asks again
once that one settles. Reads of one query share one fetch; only a 2xx answer is kept, by route and
rebuilt query, at most 64 queries a route, the least recently used out first. The Account's status
and body pass through as they are (`application/json`, `no-store`): its `{ok:false, refusal}` is
the screen's to draw, in its words. A fetch that fails — refused, past the route's abort on the
headers or the body, a body that cannot be read — is `503 {"ok":false,"unreachable":"<CODE>"}`
(`ECONNREFUSED`, `timeout`, `unreadable`), never the error's text, or the query's last kept answer
re-served with `stale: true`.

The stream is piped. The client id is required (8 to 48 letters, digits, `-` or `_`; the page
mints `face-` and 24 hex digits, once per tab); the browser's `Last-Event-ID`, when it sends one,
is the `since` passed on, in place of the query's — an EventSource reconnects to the URL it
opened, its newest id in the header; the Account's 200 is written through chunk by chunk as it
comes, never buffered or re-framed, and ends when the Account ends it; any other answer is the
Account's status and body (its refusal past 32 streams among them). The upstream is aborted when
the tab's connection closes, when the browser falls 256 KiB behind, and at shutdown — `main.ts`
disposes the proxy after the web server stops. `stream/markets` takes a body declared
`application/json` (else 415) on a bare path (any query name is 400), at most 4,096 bytes (413),
and posts it on as it came. `/data/seat.json` reads the Account's read through the proxy's own `account`
reader, so the seat box and the Account screen share one upstream read within the 15 seconds.

**The cadence** — the retired page's, no faster:

| Read | When |
|---|---|
| `/data/account` | at boot; on entering Account (past the cache when it opens on Cards) and on entering Cards (past the cache); every 20 s while Account is on screen in a visible tab, 80 s while the tab's stream is open; on Refresh and after a receipt, the seat's too (`?fresh=1`); on the stream's events |
| `explore` | the tab on screen, at once and every 20 s while Markets is on screen in a visible tab (`limit=200`, a kind's tab with its `tab`); the search once the box has been quiet for 300 ms (`q`, `limit=200`); each old `us:`/`crypto:` star once per boot (`q`, `limit=12`) |
| `quotes` | every 5 s while Markets is on screen in a visible tab: the drawn rows' most traded connected lines, twelve a call, none while one is out; on a market's page its own market's line, from the page's own view when that market is no row of the tab |
| `candles`, `compare` | on opening a market's page; `candles` again on a range |
| `holdings`, `history` | on entering Portfolio (the holdings, then the leading curve), on Refresh (the holdings), on a range (the curve), on opening a market's page (the holdings); when an Account's read naming a paper venue lands with its lens never read, or after a read the face did not recognise (the holdings — then past the cache — and the leading curve); on the stream's events |
| `statement` | on opening the Statement and a market's page; on the stream's events |
| `agents` | on entering Agents; on a `snapshot` |
| `asset`, `book`, `trades`, `funding` | on opening a market's page: the asset sheet (again past the cache after an owner action there), the book and the latest trades at the line it follows (the trades no more once the source said it publishes none), a perpetual's funding |
| `receive`, `earn`, `sellable` | a Receive row's address on **Show address** and **Read again**; `earn` on entering Money and past the cache after every taken earn; `sellable` on opening Sell many (past the cache) |
| `signin/status` | every 1.5 s for at most 15 minutes after a venue's sign-in started |
| `stream` | one per tab, open while the tab is visible; `since=<the last frame id>` on a new source; no sign of life for 20 s is stale, 45 s dead; a dead or refused source opens again after 1, 2, 5, 10, then 30 s |
| `stream/markets` | the market a page follows (sixteen at most), told on every open and every change as `{client, markets, n}` with a rising `n`, and once more a second later when the face did not take it — on Trade, the ticket's line |
| `explore` on Trade (stage 2) | the kind's picks (`tab=<kind>&limit=12`) at once and every 20 s while Trade is on screen in a visible tab; Trade's search (`q`, `limit=12`) once its box has been quiet for 300 ms |
| `venues`, `paper/books` (stage 2) | on pressing Connect an account and Open a paper account — the sheet opens with what was read, else once the read lands |
| `keyfile`, `connect/reach` (stage 2) | for an open Connect an account sheet: on opening, and after the sheet's 300 ms quiet when the key file or the connector it would ask about changed |
| `pair`, `prepare`, `exchange` (stage 2) | `pair` on each load's first page (unless this browser signed out), when a page no longer lists this device after it signed or waited, on Pair and on Sign in; `prepare` when a sheet's form is complete and after 300 ms without a change, at a signature's ten minutes and on a press under its last 30 seconds, and on a ticket's moved market; `exchange` on the sheet's go key, a star, a Cancel |
| after an owner action | the Account's read, the holdings and the statement past the cache; the seat box too after Let in, a limit or Revoke |

A stream event reads again what it names, past the cache: `order`, `fill`, `paper`, `balance` and
`position` the holdings and the Account's read; `statement` the statement; `card` the Account's read, and the seat box
for a card raised or answered; `snapshot` everything, and the prices the stream had kept are
dropped — the Account never resumes market events. A `quote` frame is the followed market's price
(its last trade, else the middle of its bid and ask). A hidden tab stops every poll and closes its
stream; a visible one opens it again from the last id and tells the follow set again.

**The fixtures** — `tests/fixtures/account/` holds the Account's answers at buyer-agent-demo
@ 133b9a7, captured from its own stand-in (the real Account over simulated venues: no network, no
money, a fresh temporary home) by `scripts/capture-account-fixtures.ts`: thirteen reads —
`account`; `explore`, All and Predictions; `holdings` and its paper lens; `positions`;
`statement`; `history` and its paper curve; `agents`; `compare` for ETH; `candles` and `market` at
the first Markets row's line at a venue connected live (the Stand-in Broker's NVDA in this
capture) — and the push channel's first frames in `stream-frames.txt` (ten, or the whole ones heard
in 20 seconds: this capture's `retry`, a snapshot, a statement line and a heartbeat). Every `native`
and `icon` key is dropped and every array cut to its first twelve entries (a frame's arrays stay
whole); stage 2 added `venues`, `keyfile` and `paper-books`, and three preparations —
`prepared-watch`, `prepared-order` and `prepared-card`, a `setWatch`, a `liveOrder` and an
`approveCard` as the Account prepares them, nothing signed — `venues` and a preparation's arrays
kept whole; `tests/account-fixtures.test.ts` holds the files to what the views read and to that
strip, and the client tests draw from them. Capture again when the Account's shapes move —
`account/` is read, never written, and the stand-in takes a free port, never 4820:

```bash
cd face && npx tsx scripts/capture-account-fixtures.ts
```

A read the Account does not answer `ok: true` stops the capture before any file is written; after a
capture, `npm test` says which view moved.

**The smoke** — `tests/account-graft-smoke.test.ts` is the canary for the Account's reads moving
under the face, as `account-seat-smoke` is for its seat. It starts the stand-in on a free port,
boots a face on a scratch home — the seat row off, so no seat process starts and
nothing lands under `~/.buyer-agent-demo` — with `FACE_ACCOUNT_URL` at it, registers the proxy and
the seat route as `main.ts` does, and asks the face's own port: `/data/account` answers 200 with
`ok` and its venues; `/data/account/explore` lists items; `explore?force=1` is refused 400 and never
asked of the Account; `/data/account/stream` is `text/event-stream` with a named frame carrying JSON
within 5 seconds; `/data/seat.json` reads the Account reachable. Then the owner's half: the
client's own `host/owner.js`, run under Node by `tests/helpers/owner-node.ts` (Node's WebCrypto, the
key in memory, every call to the face's port — never the stand-in's), pairs with the code the
stand-in printed in its log and signs; it watches the first `ex` market the page does not watch and
sees it in the page's watch list, then unwatches it and sees it gone; with the stream opened first
it buys $25 of ETH/USDT at the Stand-in Exchange at market, hears the order's `fill` within 10
seconds and finds ETH counted in the holdings risen by what filled; it rests a limit buy of
SOL/USDT 10 % under the ask and cancels it by its id; it approves the stand-in's seeded card
(Claude Code's market buy of ETH) and hears the `card` frame say `approved`; an exchange posted
from a foreign origin is refused 403; and neither the pairing code nor any of the six signatures it
sent appears in what the face's process wrote. What the stand-in cannot drill — a second device
waiting for an owner's Let it sign (it admits the first browser on the code) — the owner drill
below covers. It runs from the repo's `account/` (or `FACE_ACCOUNT_SEAT_DIR` when set) and is
skipped without `FACE_SMOKE=1` or without `npm ci` there; run it, and the seat smoke, after any
change under `account/`:

```bash
cd face && FACE_SMOKE=1 npx tsx --test tests/account-graft-smoke.test.ts
```

### The owner device (client/js/host/owner.js + client/js/wire/owner-key.js)

Since 2026-10-24 (stage 2 of the design, §6.3) this browser can sign for the Account as one of its
owner devices — the protocol of the Account's page (retired 2026-11-01), byte for byte
(`../docs/research/2026-10-22-account-owner-path-map.md`), reproduced in the client. The key is a
P-256 pair WebCrypto makes non-extractable, kept in this browser's IndexedDB (`gravit-face-owner` ›
`keys` › `device`) at the face's origin; only its public half leaves the browser, at pairing. The
face's process holds no key, makes no envelope and signs nothing: it carries the bytes.

**The device line** under the Account head says where this page stands, in one muted sentence:

| Line | What it means | Its key |
|---|---|---|
| `This page signs for the account` | this key is among the Account's owners: every owner key is drawn | — |
| `Waiting to be let in — a browser that signs lets it in, under Settings › Devices` | the Account has an owner and this page asked to sign: an owner device presses Let it sign once — another face browser that signs, under its Settings › Devices | — |
| `Pair with the code the Account printed in its terminal` | the Account has no owner yet: the code it printed makes this page the owner (five wrong tries end pairing until the Account restarts — its rule, in its words) | the code box and **Pair** |
| `Signed out` | this page signed out; nothing is paired until you sign in | **Sign in** (a new key) |
| `This browser cannot sign for the account` | no WebCrypto, or a key that could not be made | — |

Nothing is drawn while the first page has not landed. The Account's last refusal to the device
rides on the line after ` · `. The first page that lands pairs the device once
(`POST /data/account/pair {jwk, label: "Gravit face"}`); every page after re-reads where it stands.
If the Account answers a signature `E_ACCOUNT_BAD_SIGNATURE` — it restarted and lost its pending
list, or an owner dropped this device — the page pairs again, the line says so, and no owner key is
drawn until it signs again.

**Settings › Devices**: the Account's owner devices by label, this page's own marked `this page`,
the browsers waiting to be let in (`<kid> · since <date>`), each with **Let it sign** — which signs
the owners list with that device added, so a second face browser is admitted from here — and this
page's **Sign out**, a signed `signOut` of this device (in Beast the sheet offers `Switch to Guard
first: whatever an agent asks for waits for a signature`, ticked for the last device that signs):
taken, the key is deleted and `gravit.owner.signedOut.v1` is set in this browser. When the last
device signs out the Account prints a new pairing code in its own terminal; the face cannot read
it. **Keep a second face browser paired** (another profile or browser, let in from this one): the
face is the only page that signs, so a lost profile with no second device leaves nothing that can
let a new one in and no code: the way back is `npm run account -- --fresh`, which throws away the
owner, the venues, the agents and their limits (`DEVELOPMENT.md` R53).

**Every owner action is prepare → What you sign → sign**, the Account's own: the key opens a sheet
(a drawer over the screen) whose form drafts the Account's action; a complete form is prepared at
the Account at once and again 300 ms after a change; the sheet shows the Account's quote and **What
you sign**, a fold that opens on a click — every field the signature covers, `name: value`, as
the Account sent it, the nonce
among them — and the go key is on only while the shown preparation is the form's (a changed field
dims it and turns the key off until the new one lands). A money action's signature is good for ten
minutes (`Your signature is good for m:ss more.`): at zero it is prepared again, and a press under
its last 30 seconds prepares again and signs the fresh one. A refusal is the Account's sentence and
nothing is signed (`Prepare again` where the price moved or the time ran out). Only a star and a
Cancel are one press (prepare, then sign at once), as on the retired page. Each sheet's go word
says what it signs: `Let it in`, `Give the limit`, `End the limit`, `Revoke`, `Connect`, `Open the
account`, `Top up`, `Start over`, `Disconnect`, `Sign and reopen`, `Approve` / `Reject`, `Decline`,
`Let it sign`, `Sign out`, `Sign and place`, `Sign and close` / `Sign and sell`, `Sign and change`,
`Sign leverage`, `Sign Beast`, `Sign the cap`, `Renew for 30 days` / `Start a new one`, `Sign and
move`, `Sign and put in` / `Sign and take out`, `Make it`.

**The owner's keys** (each drawn only while the page signs; "Markets and Account" above says where):
- **Let in…** a knocking key — its address and name, good for 1 · 7 · 30 · 90 days (`approveAgent`).
- **Give a limit…** an agent, Gravit's own row among them — every scope (`trade`, venues, payees,
  earn; `approveSpend`): for `trade` the Account's venues as a pick list, paper first, `*` never
  offered, the dollars per order and the budget, good for 1 · 7 · 30 · 90 days; the form starts
  from the agent's standing limit. **End limit** signs the same limit at $0 for a day. **Revoke…**
  asks in place, then signs the zero address for the key's name — final for that address.
  **Open an agent wallet…** (`Make it`), and an agent wallet's **Top up…** and **Take back…**.
- **✓ Approve / ✗ Reject** a card — one card, one signature (`approveCard`); Approve re-runs the
  agent's instruction at the Account, which judges its key, limit and venue again; a card past its
  thirty minutes is refused as expired. **Grant** any kind of ask opens the matching form;
  **Decline** signs the decline.
- **Connect an account** — every connector the Account offers: a key file (an exchange, a broker:
  the connector, the venue id and name, the key file's path, checked when you pause — `Key file
  found: <path>`, `Missing: …`, the venue's own words where it is not served here — never what the
  file holds), a browser wallet (**Use <wallet>**: its challenge built on the face's origin and
  signed in the wallet), a venue's sign-in (**Sign in at <venue>**, finished through the face's
  callback), an address to watch, and the command-line connector. **Open a paper account** — a
  name and starting dollars (the id `paper-<the name, slugged>`, `-2` past one in use), or a kept
  paper book continued. **Top up** and **Start over** a paper venue (its Details). **Reopen…** a
  venue closed to agents (Close to agents itself is unsigned). **Disconnect…** asks in place first;
  the Account refuses while an order or a payment is open there.
- **Close…**, **Change…** and **Leverage…** (the Market half): close or sell a position, amend an
  open order, set a perpetual's leverage — on a market's page and the Portfolio, Change… on
  Trade's Under way too.
- **Rules**: Beast, the cap, the agents' session and their leverage (Guard is unsigned). **Money**:
  Move, Earn in and out; **Sell many** from the Portfolio. A payment the Account built for your own
  browser wallet is signed by that wallet (**Send from wallet…**), never by the device key.
- **The star** on an Account market (Markets) signs the Account's watch list.
- **Let it sign** and **Sign out** (Settings › Devices).

Not on the face, by the design (the two parts' spec §5.4): the Account's Superagent (the Desk and
its Brains), Intents and Memory — their server code and seat tools stay in `../account/`. Nothing on
the face leads to another page: the Account serves none.

### Trade (client/js/host/trade.js + client/js/render/trade.js)

`#/trade` — the rail's item between Markets and Discover; a market page's Buy or Sell opens
`#/trade/<key>` with the ticket on that side. The kinds **Crypto · Stocks · RWAs · Predictions**
(the Account's own tabs; perpetuals and pre-IPO contracts are listed on Markets and never on the
ticket — a perpetual's position is closed and its leverage set on its page and the Portfolio); the picker — **You hold**, **Watching** and **Most traded** of the kind (twelve, read
every 20 seconds while Trade is on screen), or a search's results; **Under way** — the open orders,
yours and the agents', each with **Change…** where the Account can amend it (on an Account that
takes writes) and **Cancel** (one press) where the Account knows what cancels it,
and the last thing said (a cancel's answer, a fill: `Bought 0.04 ETH @ 3,120.50 · Stand-in
Exchange`), and under them **Cards waiting** — each card waiting on you, `reason · value · answer
by`, with **Review →** to Account › Cards, where it is answered (no key signs here); and the ticket:

- **Where** — the market's lines at the venues you connected that trade, `Best` on the lowest ask
  among those that take an order now, `Paper` where so; a public listing reads **Connect to trade**
  and leads to Account › Venues.
- **Buy or Sell**, **Amount** in dollars or in the market's unit (shares, contracts, the coin),
  **Market** or **Limit** (a prediction's limit in cents), **Extended hours** on a limit where the
  line offers it. Stops, time in force, post-only, reduce-only, trailing, take-profit and
  stop-loss are not drawn and travel empty.
- The Account's quote of the order (its words, what it costs, up to what if the price moves, its
  fee or `fee as <venue> charges it`, `Paper`), the signature's minutes, **What you sign** (a fold
  that opens on a click: the seventeen fields and the nonce), and **Sign and place**. The answer
  is the order's line
  (`ord-0007 · open on the book`, `filled`) and the fill is told when the stream hears it; a
  refusal is the Account's words. The ticket follows its market on the stream and, once the price
  moved from the one the shown preparation stood at, prepares it again quietly.
- **Hand to Gravit instead** — the market in a new message, as on a market's page.

On a page that does not sign Trade still shows the picker and Under way; the ticket shows the
device line where the form would be — no Sign and place, no Change…, no Cancel.

**What holds the owner's hand** (the charter's D18): no gate of this tree's — Gate 2 is the
agent's. The Account's live cap bounds each order (`npm run account -- --live-cap 1` caps any real
order at a dollar), its venues' rules apply, and What you sign is drawn before every signature.
The face cannot tell a paper venue from a real one beyond the Account's `Paper` flag: **connect
paper venues only** until the operator decides otherwise — a real venue connected to the Account
and an order placed on it by hand from the face is the charter's revisit trigger.

**The risks, named** (the design's §11): the face spells the Account's shapes by hand —
a changed read reads `unreadable`, a changed envelope refuses every signature and the device line
says so; re-run the smoke after any change under `account/`. A second device needs an owner's word once.
The browser profile is the device: clearing the face's site data loses the key, the Account keeps
the old device's row, and the new one is let in like any other by a device that still signs — no
export, no backup; with no other device, nothing can (R53: keep a second face browser paired). The proxied
owner routes are as open as the Account's own door: a local process reaches them without the face's
cookie and does nothing without an admitted key, but it could ask to sign — so refuse a waiting
device you do not recognise. One stream per tab: three tabs are three of the Account's thirty-two.


## The desk (src/desk*.ts + src/telegram.ts + src/us-quotes.ts)

The desk is Gravit on the operator's phone: one long-lived desk conversation that informs and
never orders (the desk spec's P1,
`../docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` §5.3 and §5.6–§5.8). It runs
in every face with the desk on — `FACE_DESK` unset — whether Telegram is configured or not.

**The desk session.** One dsh session of the `gravit-desk` preset, its cwd `desk/journal/` and
its sandbox `workspace-write`, pinned when the face creates it. The face opens it at boot —
the newest one the ledger names, or a new one — and keeps it until the phone's `/new`. A ledger
session whose header names another preset or another directory is replaced by a fresh one; one
that runs any permission preset but `workspace-write` — switched in the browser, say — is not,
and every text then gets `the desk could not open a turn: …` until `/new` opens a fresh one. The
preset is Gravit's persona with the desk's contract, `../dsh/profile/desk.md`, in place of the
roles and the cycle, and an allow list in place of Gravit's roster: `read`, `write`, `edit`,
`read_image`, `glob`, `grep`, `str_replace_editor`, `skill`, `web_search`, `todo_write`, and
the retired alpaca-kit's `earnings`, `daily_bars`, `calendar` and `corp_actions` (which match no
tool since `alpaca_kit` left the tree). No shell and no
background jobs: an unattended turn on untrusted text — a forwarded message, a web page, a
filing — must not read the key files and reach the network. No order or account tool, no
question tool, no goals, no delegation, no AKShare. Two tools are the desk's own:
`desk_quotes`, the price now for 1 to 20 US symbols, its source and its time in New York
(`NASDAQ REAL-TIME 15:21:03 ET`), from the Account's market read (`src/us-quotes.ts`: its
`explore` row per symbol, through the proxy in-process) — with the Account not running it
answers `unavailable: the Account is not reachable …`, and a symbol it lists no share for has no
price; and `desk_state`, what `/data/desk/status` says, with the ledger's
last 10 runs. An order tool the desk names is refused by Gate 2 with no card: the session
cannot see it.

Every turn on the desk session is supervised, whoever opened it — the phone or the browser: a
5-minute deadline from its start that no card or tool extends, the fence below checked at its
start, and one ledger line: a `desk-turn` with its outcome — `ended`, `timed-out`, `cancelled`
with what cancelled it (`stopped from the phone`, `shutdown`, `stopped in the browser`), or
`failed` with its error — wall time and tokens, or a `desk-refused` when the fence cut the turn.
A turn from the phone answers to the phone; a turn opened in the browser answers in the browser
only. A cut — the deadline, or `/stop` — cuts one turn: the texts you sent while it ran are
answered after it, each in its own turn, in the order you sent them.

**Set up the bot**, once:

1. In Telegram, message **@BotFather**, send `/newbot`, and choose a name and a username that
   ends in `bot`. BotFather answers with the bot's token. It is a key: never paste it into a
   chat, a ticket or a commit.
2. Open the new bot and send it any message (`/start` will do).
3. Find your numeric user id, one of two ways. Open
   `https://api.telegram.org/bot<token>/getUpdates` in a private browser window, your token in
   place of `<token>` — the window keeps the token out of the browser's history — and read
   `message.from.id`; do it before any face has the token, since a polling bridge takes the
   updates first (it answers that first message later, as text). Or let the bridge tell
   you: put the token in with `TELEGRAM_OPERATOR_ID=0` (step 4), restart, message the bot, and
   read your id in the `drop`
   record of `$DSH_HOME/face/desk/telegram.jsonl` — every message is dropped while the id is 0 —
   then set your id and restart again.
4. Put both in the harness home's `.env` — the service's environment ("Run as a service"):

   ```
   TELEGRAM_BOT_TOKEN=<the token>
   TELEGRAM_OPERATOR_ID=<the numeric id>
   ```

   `npm run service -- install` copies the two names from a repo-root `.env.telegram` when the
   home has no `.env` yet. A home that has one gets the two lines by hand; the file stays
   `0600`. Then `npm run service -- restart`. A terminal `npm start` reads the home's `.env` at
   boot too.

Both names, or no bridge: with either one missing, or an id that is not all digits, the face
runs the desk without a phone, and `status` says `telegram: not configured (…)`. The token
never reaches the `agent_<bin>` runs or the instruments' producers (the face drops it), nor a
shell turn or an MCP server (dsh's scrub). A workbench session's shell can still read
`$DSH_HOME/.env`, as it can every key file (charter D20); the desk has no shell, and its guard
keeps its reads off them (below).

**What the desk can read, and what reaches the phone.** dsh's sandbox lets every read through,
so the face's desk guard holds the desk's reads (`DEVELOPMENT.md` §4.2), and refuses before the
tool runs:

- a read outside the repository — `$DSH_HOME`, `~/.ssh`, `~/.config`, a checkout outside it,
  through a symlink too: `the desk reads only inside the repository; <path> is outside it`;
- a `.env`, `.env.<anything>` or `.git` name, in any letter case: `the desk never reads <name>: it
  can hold a key`;
- any other name that starts with a dot, below the repository root — `.mcp.json`,
  `.claude/settings.local.json`, `.codex/`, the worktree checkouts under `.claude/worktrees/` —
  as spelled or where a symlink lands: `the desk never reads dot-files: <name>`;
- a search that could reach a dot-file — a `grep` include whose segment starts with `.`, `*`,
  `?`, `[` or `{`, or a `glob` pattern whose segment starts with `.`:
  `the desk never searches dot-files: search with no include, or one that starts with a name`,
  so a `grep` include `notes*.md` goes and `*.md` does not, ripgrep's `--glob` lifting its skip
  of hidden files;
- any call — a search, a market read, a write — whose arguments carry the value of a key in the
  face's environment: `the desk never sends a secret: this call carries one`.

The bridge then replaces every such value with `<secret>`, and the token with `<token>`, in
everything it sends, queues or keeps. The secret check is a backstop: it finds a value as it is,
JSON-escaped or URL-encoded, and misses a lower-case `%3a`, a base64 spelling and a value split
across arguments, so the read refusals above are what keep a key out. What remains: a key kept
in a file whose name says nothing and starts with no dot (`credentials.json`, a note), or one an
MCP tool returns, reaches DeepSeek in the tool result, and the phone too unless the face's
environment holds that value; a hard link, or a symlink swapped between the check and the read,
is not seen; and a `grep` with no include, which ripgrep keeps off hidden files, searches one
that an ignore file whitelists — a negation such as `!.env.alpaca` in a `.gitignore`, `.ignore`
or `.rgignore` in the tree it searches or above it; a test keeps the repository's tracked ignore
files free of one, and the desk cannot write one (`DEVELOPMENT.md` §9, R57). Keep keys in `.env`
files, in dot-files or in the harness home.

**The model.** `FACE_DESK_MODEL` is the desk's route, `provider/model`; unset, it is
`deepseek-official/deepseek-flash`. A route the tree does not serve falls back to the tree's
default selection — Gravit's model, the `agent-default-model` row's — with one line:
`gravit-face: desk: model route <route> is not usable (<reason>); the desk uses the default
<provider/model>`. For the service, set it in `$DSH_HOME/.env` by hand
(`install` copies an allow-list, and this is not on it). It takes effect at the next start, on
the desk conversation that start resumes too.

**From the phone.** One operator, one private chat. A message from anyone else, or from a group,
is dropped unanswered, counted, and its sender id recorded in `telegram.jsonl`; `status` shows
the count. Text goes to the desk under a first line Gravit reads as its provenance —
`[telegram · operator · 14:03 ET]`, the time you wrote it; a photo, a file or a voice note gets
`text only on the desk`. Four commands are the bridge's own, in any letter case, with or without
`@<bot>` after them:

| Command | What it does, and the reply |
|---|---|
| `/status` | `npm run service -- status`'s desk, pause and Telegram lines, then `desk session <id>` and `turns today <n>` |
| `/pause` | pauses the desk until a terminal resumes it: `paused; a terminal resumes it: npm run desk -- resume` |
| `/pause 30m` (`Nm`, `Nh`, `Nd`) | pauses it for that long: `paused until 14:33 ET; …`; any other argument pauses nothing and says how to write one |
| `/new` | opens another desk conversation: `a new desk conversation`; a turn under way on the old one still answers |
| `/stop` | cancels the turn under way, and only it: `stopped`, or `nothing is running`; texts you sent while it ran are answered after it, in order |

Any other `/word` is text for Gravit. There is no `/resume`: the phone only makes the desk
quieter, and a pause from the phone never shortens one in force — `/pause 1m` during a 2-hour
pause leaves the 2 hours, and the reply says so.

What comes back: the answer as plain text, in parts of at most 4,000 characters, cut at line
ends where it can be — followed by a line `(cut off: <what cut it>)`, such as `(cut off: timed
out after 5 min)` or `(cut off: stopped from the phone)`, when a cut caught the answer
mid-sentence; `timed out after 5 min; a
card or a long tool was pending` when the deadline cut a turn before it said anything; `the desk
could not answer: <error>; nothing was done - send it again later` when the model call failed;
and `the desk is slow to take this; it will answer when it can` when the desk took more than 30 s
to accept a text. A send that fails
waits in `outbox.json` (at most 100 messages) and goes out, in order, before the next poll; one
sent more than 2 minutes after it was written opens with `(written 14:03 ET, sent late)`.
Telegram's 403 — you blocked the bot, or never started it — drops the message, and `status`
says `blocked (403)` until a send goes through. Telegram's 409 means another poller holds the
token — a second face started without `FACE_DESK=0`, a webhook, or someone else with the
token — and `status` says `conflict at …`; the bridge waits 30 s and polls again. A revoked or
mistyped token fails every poll, and `status` says `poll failing since <time>: <reason>` until a
poll answers. Every value of a key in the face's environment goes out as `<secret>`, the token as
`<token>`, and an outbox an earlier run left is redacted as it is read.

**A lost phone.** The bridge admits by your user id, not by the device, so a phone that is still
signed in to your Telegram account keeps chatting with the desk — having it read inside the
repository, write in its journal and spend tokens — and can pause it. Rotating the token does
not stop it. End that device's session from another device (Telegram → Settings → Devices), or
remove `TELEGRAM_OPERATOR_ID` from `$DSH_HOME/.env` and restart the face until you can. Rotate
the token — @BotFather's `/revoke`, then the new one in `$DSH_HOME/.env` and a restart — only
when the token itself leaked: whoever holds it can read what you send the bot, through `getUpdates` or a
webhook of their own, which the face sees only as a 409 (`conflict at …`).

**The pause.** The switch is a file, `$DSH_HOME/face/desk/OFF`. While it is there the desk opens
no turn, and a text gets `paused since 14:03 ET by telegram until 16:03 ET; a terminal resumes
it: npm run desk -- resume`. Set it from the phone (`/pause`), from `POST /data/desk/pause` (the old
client's Desk panel used it; its gravit-ui port is owed), or from a terminal:

```bash
cd face
npm run desk -- pause        # until a resume
npm run desk -- pause 2h     # for Nm, Nh or Nd
npm run desk -- resume       # lift it: only a terminal does
```

A timed pause lifts itself at its end, the next text finding it expired. Deleting the file lifts
any pause too, and `touch` of it sets an open-ended one. `npm run desk` acts on the harness home
this shell resolves — `DSH_HOME`, else `~/.dsh` — not on the one the installed service names;
set `DSH_HOME` to match when they differ. It waits up to 2 s for the switch's lock, `OFF.lock`,
and says `cannot remove …/OFF: atomic-write: timed out waiting for the writer lock at
…/OFF.lock` when it cannot get it. A lock left by a killed holder whose pid has since been
reused stays until you remove it by hand; deleting `OFF` still lifts the pause meanwhile.

**The fence.** dsh reads `GRAVIT.md` and `GRAVIT.local.md` in every directory from the
repository root down to a session's cwd, and in any directory a turn touches below it; a `.git`
would make a directory a project root of its own, with `.dsh` and `.agents` skill roots. The
journal is gitignored, so nothing would show such a file there. So the face refuses every desk
turn — a phone text gets `refused: <path> exists; it would steer every later desk turn. Remove
it, then write again.`, `<path>` from the repository root (`desk/journal/notes/GRAVIT.md`), and
the ledger a `desk-refused` line — while any of these exists:

- a `GRAVIT.md`, `GRAVIT.local.md`, `.git`, `.dsh` or `.agents` directly in `desk/`, or anywhere
  under `desk/journal/`, in any letter case (this Mac's volume opens `gravit.md` as `GRAVIT.md`);
- a `.dsh` or `.agents` at the repository root;
- a symlink anywhere under `desk/journal/`, or `desk/` or the journal being one;
- anything there it cannot read: the check fails closed.

Remove it, then send the text again. Two everyday ways to trip it: Emacs's lock files (`.#name`)
are symlinks, so a journal note open in Emacs with unsaved edits refuses every desk turn until it
is saved; and a root `.agents/` adopted for another tool refuses the desk while it is there.

The desk cannot plant one itself: its guard's write check denies a desk turn's `write`, `edit` or
`str_replace_editor` whose path names one of those five, before it runs — in the journal, above
it (`../GRAVIT.md`), anywhere else in the repository and in the harness home (`~/.dsh/…`) alike,
the names judged below the repository root — with `the desk never writes GRAVIT.md: it would
steer every desk turn after it`; a `str_replace_editor` `view` passes. A desk session whose own
directory sits under such a name writes nothing at all (`the desk does not write while its
directory sits under <name>`). The same check denies the files other tools obey: any file or
directory whose name starts with a dot — a `desk/journal/.gitignore` holding `!*` would have git
list the journal, your book, for the next `git add -A` — with
`the desk never writes dot-files: <name>`; and any `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` or
`AGENTS.override.md`, in any letter case — your coding agents load them from the folder they work
in — with `the desk never writes <name>: another agent reads it`. The fence is for what another
session plants.
The root `GRAVIT.local.md` is not fenced: it is the operator's own overlay, read by every desk
turn (`DEVELOPMENT.md` §9).

**In the browser.** The Desk panel - the desk's status, the pause and its control, the bridge, the
conversation, today's turns, the standing orders and the desk's sessions - was built in the old
client, which main replaced with gravit-ui; it was dropped in the merge (2026-11-01) and its port
to gravit-ui is owed to P3. Until then gravit-ui lists the desk's sessions as it lists any, and
`GET /data/desk/status` is the desk's state for a page.
Both desk routes, `GET /data/desk/status` and `POST /data/desk/pause`, keep only the `/data`
loopback fence and no cookie ("Data routes and caches"), so anything on this machine — a shell
turn included — can read the status and pause the desk: the safe direction (charter D19).

### Standing orders (src/schedule.ts + src/firing.ts + src/standing.ts + src/brief.ts + src/market-clock.ts)

The desk's clock fires the operator's standing orders on the exchange calendar (the desk spec's
P2, §5.4 and §5.9): each is a text the operator wrote and armed, fired at its anchor in a fresh
desk session whose final text goes to the phone — informing, never ordering (charter §1). The
first is the pre-close brief: `desk/STANDING.md`, tracked, with `builtin:brief`, the face's own
producer, which prices the desk's book — `desk/holdings.yml` and `desk/levels.yml`, gitignored,
with `desk/holdings.example.yml` and `desk/levels.example.yml` tracked beside them — and the
index and sector ETFs from one snapshot of the desk's US quote source (at most 200 symbols; any
past that are named in the brief). That source is the Account's market read
(`src/us-quotes.ts`); with the Account down the brief reads the book and carries every price
null, its `quotesError` `quotes unavailable: the Account is not reachable …`. A strategy's `strategies/<name>/levels.yml` is not read yet: research
sessions can write it, and the brief's text reaches the phone, so it joins once P4 pins each one
at arming (`DEVELOPMENT.md` §9, R67); the brief says so.

**Arm it** from a terminal, in `face/` of the checkout the service runs: `arm` hashes that
checkout's files, and the service checks its own (`DEVELOPMENT.md` §9, R65).

```bash
cd face
npm run desk -- arm desk --id preclose --at close-30m --producer builtin:brief --expires 2026-12-31
# armed preclose in <root>: desk/STANDING.md sha256 <12 hex>…, at close-30m, expires 2026-12-31, producer builtin:brief; the face reads standing.yml again within 30 s
```

`arm` adds the order to `$DSH_HOME/face/desk/standing.yml` (mode `0600`) — on the harness home
this shell resolves, as `npm run desk -- pause` does — with the sha256 of `desk/STANDING.md` and,
for a script producer, of its script. Its arguments:

- `desk` or `strategies/NAME` — where the order's text lives and its turn runs: `desk` runs in
  `desk/journal/`, `strategies/NAME` in that directory;
- `--id` — a-z, 0-9 and `-`, opening with a letter, at most 40 characters;
- `--at` — `open`, `close`, `open±Nm` or `close±Nm` (N 1–600; `open-Nm` at most 570 and
  `close+Nm` at most 479, so the anchor stays on its session's New York date), or `HH:MM` New
  York time; XNYS sessions only, early closes included: `close-30m` is 15:30 ET, and 12:30 ET on
  2026-11-27 and 2026-12-24, while a `15:30` order stays at 15:30. A `close-Nm` must leave room
  for what runs before the close and the 5-minute grace — the producer's deadline when there is
  one, the turn's when it wakes one (`close-15m leaves 15 min before the close; its producer
  (5 min), its turn (10 min) and the 5-minute grace need 20 min`; a `--no-wake` order, `close-5m
  leaves 5 min before the close; its producer (5 min) and the 5-minute grace need 10 min`);
- `--expires YYYY-MM-DD` — required: the last New York date it fires, not before today;
- `--producer scripts/FILE.py | builtin:NAME` — what runs before the turn, its output quoted in
  the wake message: `builtin:brief`, or one `.py` file directly under `scripts/`, pinned by its
  bytes and run from a private copy of them as `python -I` with no shell, cwd the repository root,
  its input as JSON on stdin and an environment of `PATH`, `HOME`, `LANG`, `TZ`, `LC_*`, `APCA_*`,
  `ALPACA_*`, `ALPHA_*` and `GRAVIT_ROOT` (the root, for reading files; never an import path), its
  whole process group killed at its deadline. The pin covers the script's bytes; a research
  package it imports is installed into the interpreter, never imported from the tree
  (`DEVELOPMENT.md` §9, R63);
- `--turn-deadline` (1–30 min, `10m` by default) and `--producer-deadline` (10 s–180 min, `5m` by
  default), each `<n>s` or `<n>m`;
- `--model PROVIDER/MODEL` — the turn's route; without it a firing runs Gravit's default model,
  not the desk's flash; one the tree does not serve falls back to the default with one line;
- `--no-wake` — run the producer alone: no turn, and no message unless it fails.

`arm` refuses with one line, `cannot arm <id>: <reason>`, and writes nothing: a taken id
(`<id> is already armed; npm run desk -- rearm <id> takes a changed file's new hash`), a bad value,
a market calendar that does not answer for today, a
`standing.yml` the face refuses, and a file changed between its read and its write (`run the
command again`). An order armed at the anchor of another enabled one gets a `note:` line: orders
sharing an anchor run one after another, so the later may start late — and a close-anchored text
that finishes after the close is held back. A `standing.yml` refused because an order in it is not armed — one written by hand
without its `armedAt` and pins — names the way out: remove that order from `standing.yml`, then arm
it again.

**After an edit** to `STANDING.md` or a script, the next anchor is refused with its line
(`preclose · <date> refused: desk/STANDING.md changed since arming. Review it, then: npm run desk --
rearm preclose`) until you review the change and re-arm:

```bash
npm run desk -- rearm preclose                        # take the reviewed files' new hashes
npm run desk -- rearm preclose --expires 2027-03-31   # extend its last day, an expired order's too
```

`rearm <id> --expires` moves only the last day, and is refused while a pinned file has changed
(`cannot re-arm preclose: desk/STANDING.md changed since arming; review it, then: npm run desk --
rearm preclose`, every moved pin named; a plain `rearm` marks each pin it took `(changed)`): an expired order never fires, so nothing refused that edit. The way after an edit
is review, `rearm <id>`, then `rearm <id> --expires <date>`. A re-arm inside the 5-minute grace
fires that day.

**`standing.yml`** is yours: `arm` and `rearm` write it, you may edit it by hand, and the face only
reads it. It is a mapping of `budget:` and `orders:`, read strictly — a date `YYYY-MM-DD`, a boolean
only `true` or `false`, a time only `HH:MM`, a duration only `<n>s` or `<n>m` — and any fault (a
typo, an unknown key, an order without its arming fields) stops every order until it is fixed, with
one phone line per distinct error. `enabled: false` silences an order without removing it.

```yaml
budget:
  dailyTokens: 2000000   # the desk's tokens per New York day
orders:
  - id: "preclose"
    # … as arm wrote it
```

`budget.dailyTokens` caps the plain sum of the four token buckets of every desk turn since 00:00
ET — the phone's, the browser's and the firings'. Set it after the first measured week (the spec's
§6); until then the status says `cap not set`. Spent, the standing orders are refused for the rest
of the day with one line, and each phone text is answered with the budget line instead of a turn;
a turn opened in the browser still runs, and the pause outranks the budget.

**When an order fires.** The clock ticks every 30 s and asks the market calendar — the XNYS rule
table in `src/market-clock.ts`, Node alone (the fixed holidays with weekend observance, the
Monday holidays, Good Friday by the computus, Juneteenth, the 13:00 ET early closes and a table
of ad-hoc closures) — once a New York day. A closure NYSE announces after that table's last edit
is unknown until it is added (`DEVELOPMENT.md` §9, R64). An order is
due from its anchor to 5 minutes past it. Before it runs the face checks the pause, the day's
budget, the instruction-chain fence ("The fence" above) and then the text's and the script's
pins; a refusal consumes nothing, so an order lifted inside the grace still fires. One firing
runs at a time, a queued one even past its grace — so orders sharing an anchor run one after
another, the later starting late. A firing is a fresh `gravit-desk` session in the order's
directory — never the phone's conversation — woken once with the verified text, the session's
times and the producer's output, under the order's turn deadline; its final text goes to the phone
through the same pause as every desk message. A close-anchored text that finishes after the close
is held back with one line, since it describes a market that has moved. The brief's turn also saves
its message as `desk/journal/briefs/<date>-preclose.md`. An anchor the face missed — asleep, not
running, or found past its grace — is never run late, and a firing a restart cut off never runs
twice. Every step is a line in `$DSH_HOME/face/desk/firings.jsonl`.

**`FACE_PYTHON`.** Only a standing order's `.py` script producer runs on an interpreter:
`FACE_PYTHON`, else the first `python3` on the `PATH` the service's plist froze at install, as
`python -I`. None ships; a research package such a producer needs is installed into that
interpreter's own site-packages (`-I` leaves out the user site and `PYTHONPATH`), never imported
from the tree. The service reads `FACE_PYTHON` from `$DSH_HOME/.env`.

**What the phone gets**, besides each firing's text — `<id> · <date>` is the order and its
session's date, times New York's:

| When | Line |
|---|---|
| the turn timed out with no text | `<id> · <date> timed out after <n> min; a card or a long tool was pending` (`<n> s` when not whole minutes) |
| the turn ended with no text | `<id> · <date> ended with no text` |
| the model call failed | `<id> · <date> could not answer: <error>; nothing was done` |
| something cancelled the turn first | `<id> · <date> was cancelled (<cause>); nothing more will be said` |
| the fence refused it | `<id> · <date> refused: <path> exists; it would steer every desk turn. Remove it.` |
| no turn started | `<id> · <date> never started a turn; nothing ran` |
| the session could not run | `<id> · <date> could not run: <reason>` |
| the turn left a fence violation | `<id> · <date> left <path> behind; every desk turn is refused until it is removed` |
| its text or script changed | `<id> · <date> refused: <path> changed since arming. Review it, then: npm run desk -- rearm <id>` (both moved: `<text> and <script> changed since arming. Review them, then: …`) |
| its text or script is missing | `<id> · <date> refused: <path> is missing. Restore it, or remove the order from standing.yml` |
| finished after its moment | `<id> finished after the close; not sent - it describes a market that has moved` (`the open` for an open-anchored one) |
| the budget spent | `standing orders are refused for the rest of the day: the desk's token budget is spent (<used> of <cap> tokens since 00:00 ET)` |
| missed | `<id> · <date> missed its <HH:MM ET> anchor: <why>. A standing order never runs late` — `the face was asleep from … to …`, `the face was not running` or `found at …, past the 5-minute grace` |
| cut off by a restart | `<id> · <date> was cut off by a restart; a standing order never runs twice` — it may follow a brief that did arrive: a crash between the delivery and its record |
| expired | `<id> expired after <expires> and no longer fires; extend it with npm run desk -- rearm <id> --expires <YYYY-MM-DD> to keep it` |
| a `--no-wake` producer failed | `<id> · <date> producer <spec> failed (<error>); nothing was woken` |
| `standing.yml` refused | `standing.yml is refused, so no standing order runs until it is fixed: <errors>` (joined with `; `, cut at 500 characters) |
| `firings.jsonl` unreadable | `the firing ledger <path> cannot be read (<code>), so no standing order runs until it can` |
| no calendar | `no standing order runs today: the market calendar failed in <clock> (<error>)` |
| a phone text while the budget is spent | `the desk's token budget for today is spent: <used> of <cap> tokens since 00:00 ET. It opens again at midnight ET, or raise budget.dailyTokens in standing.yml` |

The pause sends none of them: a paused order is refused in silence. A line the pause holds back
is not lost: a missed, interrupted or expired line and a firing's refusal go out, in order, at
the first tick after the lift, and a `standing.yml` refusal, an unreadable ledger or a day without
a calendar is phoned then if it still stands. This table is the source for the phone's lines; it
supersedes the P2 plan's, which has no `cancelled` row.

**Where to see it.** `npm run service -- status` and the phone's `/status` end with the budget
line (`budget: 1,234,567 of 2,000,000 tokens today`) and a line per order —
`standing preclose: close-30m, next 12:30 ET; last delivered 2026-11-26 15:31 ET`, or what holds
it (`desk/STANDING.md changed since arming (npm run desk -- rearm preclose)`, `expired after …`,
`disabled`). The Desk panel's Standing orders card showed the same; it left with the old client,
and `firings.jsonl` holds every firing until its gravit-ui port.


## Channels (src/channels.ts + src/roster.ts + the list's groups and a channel's page)

A channel is one directory, given an identity by the host and a roster by the
operator. Three layers, split by who may write them:

| Layer | Lives in | Writer |
|---|---|---|
| **Body** (content) | `strategies/<dir>/`, or the repo root | Gravit, freely |
| **Identity** (container) | the dsh workspace registry (`~/.dsh/storages/workspace.json`) | host-owned, only through the registry — the host's `workspace/*` Remotes, and the face's reconcile calling it in-process |
| **Roster** (runtime) | `$DSH_HOME/face/channels.json` — `agents[]` (local CLIs Gravit may call) and `bots[]` (the voices a room may dispatch) | the operator, on the channel page |

The directory is the truth of existence, not the registry: `listChannelDirs`
(`src/channels.ts`) walks `strategies/*`, skipping `_template` and any name
starting `.` or `__`, and adds the repo root by hand (it has no `strategies/`
parent, so it stays the `workbench` entry). `workspaceRegistry.create` is
idempotent — canonical path, at most one record per path, a repeat call
returns the existing title unchanged — so a channel Gravit makes with a plain
`mkdir` becomes a channel on the very next listing.

**The reconcile** (`reconcileChannels`, `src/channels.ts`) runs on every
listing — both the `GET` that feeds the list and New message's Where and the
`POST` that feeds a channel's own page — and is idempotent by construction: `create`
is a no-op past its first call, `attachSession` early-outs on membership
before validating anything, and seeding a roster (`seedRoster`) is a no-op
once the channel has one. A steady-state listing performs no writes at all.
Because it CAN write on a `GET`, `channels.json`'s two writers — the
reconcile's seed and the operator's roster edit — both go through
`withFileLock` + `writeFileAtomic`, reading the file *inside* the lock, so a
list refresh racing an operator's save cannot silently revert it. A
workspace whose directory has vanished is reported (`missingDir`), never
deleted; its sessions stay attached and reachable (the gravit-ui client lists
such a channel like any other, and its page reads empty).

**Where and the list are registry-driven, not directory-scanned.** **New
message** offers **Where** — a select of the channels from `/data/channels.json`
by their display titles, the root first, then **New channel…**, which opens a
name box under it (the name folded as below, `POST /data/channels`, the new
channel selected once the list carries it) — and `session/create` takes the
chosen `workspaceId`. (The old chat page's picker also had a `choose a local
folder…` row through the OS's own dialog, `directoryPicker/pick`; the gravit-ui
client has none.) The list groups sessions by channel MEMBERSHIP, not by path
prefix: every channel is a group — an empty one too, so a new channel's page is
reachable — the root first, then by each group's newest session; a bot's home
sessions under the bot; a session no channel claims under **No channel** —
never dropped, charter Rule 5 — and the archived ones last, under a folded
**Archived**. The archive is the UNION of the face's own reversible set
(`archived.json`, read through `/data/sessions-meta.json`) and the host's one-way
`workspaceRegistry.archivedSessionIds`, because the two already disagree on
disk and neither alone is honest about what is archived.

Groups fold (the chevron on a group's head; the fold is per browser, in
`gravit-ui.prefs`, and a folded group still shows the conversation on screen),
and a conversation's **Details** carries its row actions: **Change words** and
**Fork** are the host's own Remotes (`session/rename`, `session/fork` — a fork
opens at once; dsh forks only from a completed turn, so a conversation with
nothing in it offers no Fork; a rename resumes the session first, so on a cold
one it is a write like a prompt, see "The wire and the transcript"); **Archive**
(or **Un-archive**) and **Delete** are face routes, neither offered while Gravit
runs or a card waits. dsh 0.2.0-rc.2 has no
session delete Remote at all, and its archive (`workspace/archiveSession`) is
not presentation: a host-archived session runs no model step until the host
restores it. So the face keeps its own fold — metadata in
`$DSH_HOME/face/archived.json`; the session still exists, under **Archived** at
the list's end, reversible — and never un-archives a host archive: Details says
`Archived · By the host` and offers no key, and the route answers 409 with the
reason (upgrade decision D14). Delete removes the session's persistence
directory permanently (asked twice, never offered on a running session, no
undo) and tombstones the id: a session deleted while its agent is still
attached keeps listing from host memory until the next face restart — and
write-behind can even re-persist its directory — so the list hides tombstoned
ids unconditionally and the ghost dies with the restart. Archiving or deleting
the conversation on screen opens the first open one. Opening a cold session no longer attaches it (it is paged, not
followed — D16), so viewing and then deleting stays off that path; the
attached case is a session this face run prompted, renamed or `@`-addressed.
`deleteSession` also constrains itself to sessions whose `cwd` resolves inside
this repo, not merely to an id it happens to find, closing a pre-existing gap
where the delete button could reach another project's session directory. It
reads that `cwd` from the directory's highest canonical log generation —
`session.v4.jsonl.zstd` for a session born or written under 0.2.0, else the
0.1.1 `session.jsonl.zstd` — and the `rm -r` takes every generation, the lock
and any staging file with it.

Deleting a session does NOT detach it from its channel: the id stays in the
registry's `sessionIds`, because the host's `workspace/*` Remotes at 0.2.0-rc.2
— `create`, `initializeDefault`, `rename`, `delete`, `insertBefore`,
`insertSessionBefore`, `archiveSession`, `unarchiveSession`, `pinSession`,
`unpinSession`, and the `follow` stream — offer no way to remove one session
from a workspace. The orphan is inert — nothing resolves it, so nothing renders it,
and the list draws rows, not `sessionIds` — but
`/data/channels.json` does carry dead ids, and a reader counting that array
will over-count. Drilled 2026-09-04: deleting a session left its id under
`storage-chain` with its persistence directory gone.

The sandbox boundary follows the workspace — deliberately: a channel session
writes its own `strategies/<name>/` freely, and anything outside (the repo's
`.git` included) only through a Gate-2 escalation card. The write map's
"Gravit works strategies/ freely" becomes code, and a `git commit` from a
channel session is an approval the operator answers — accepted trade,
2026-09-01.

Four routes feed all of this, every one behind the same `isTrustedDataRequest`
fence as `/data` everywhere else — read "the honest limits" below before
treating that fence as authentication:

| Route | What |
|---|---|
| `GET /data/channels.json` | the reconciled list, the `ungrouped` bucket, the archive set |
| `POST /data/channels/overview` | one channel's page payload — `{workspaceId}` in |
| `POST /data/channels/agents` | the operator's roster write — `{workspaceId, agents}` in |
| `POST /data/channels` | create — `{name}`, copies `strategies/_template`, then reconciles; answers `{name, dir, isRoot}` (no workspace id — the client finds the new channel by its `dir` in the next listing) |

**A channel's page** (`client/js/render/channel.js`, `#/channel/<workspaceId>`)
opens from a channel's name in its group head — the chevron only folds the
group — and the list stays beside it. The head: the channel by its title, the
`status.yaml` status as a chip, and **New round** (New message with Where on
this channel). Then, each skipped when its source is absent: the headline
(`one_line`, `Next: <next>`, `numbers` as rows — see `GRAVIT.md`); **Thesis**
(`THESIS.md` drawn as markdown, an untouched `_template` copy detected
byte-exact and shown as `No thesis yet` rather than presented as content);
**Latest backtest** (the newest `backtests/*.json`: its file name and up to
twelve of its top-level scalar fields — the whole file stays in the channel's
directory) and **Backtests** (file and size), both only for an old strategy
that carries a `backtests/` directory — nothing writes one since 2026-10-24;
**Journal** (`journal.md`'s `- YYYY-MM-DD:` lines, the newest twenty); **Files** (one level of the directory,
`__pycache__` filtered: name, size, date); **Agents** and **Bots** — the
channel's rosters, each with **Edit**: a box per choice (the connected CLI
agents that answered on this machine; every bot but Gravit's own composition),
ticked as rostered, a rostered one no longer offered kept to untick, at most six
bots; ✓ saves through the roster routes and re-reads the page. A failed read
says `Channel unavailable` with Retry, or keeps the page under `As of HH:MM ·
stale`; an unknown id reads `Channel not found`. Everything on the page was
written into the channel's directory and is drawn as text (the thesis through
the DOM-built markdown), never as markup.

**The roster**, `$DSH_HOME/face/channels.json` (`src/roster.ts`), keyed by
workspace id so a directory rename never loses it:
`{"version":1,"channels":{"<workspaceId>":{"agents":["codex"]}}}`. A newly
adopted channel is seeded from whichever agents are connected at that
moment — there is no "absent means everything" rule; a channel's roster is a
definite, visible set at every moment. The enforcement point is
`agent_<bin>`'s own `execute` (`agentToolDefinition`, `src/agents.ts`): it
reads the calling session's cwd, resolves its channel, and on a miss THROWS —
naming the channel and its current roster verbatim. The tool pipeline
(`dsh-tools`) catches a thrown `execute` and turns it into an `isError` result
carrying that message, so what Gravit actually sees is a tool result, never a
crash — but the mechanism there is a thrown `Error`, not a returned value.
That refusal message IS the roster's contract; it is deliberately not written
into the channel's own `GRAVIT.md`, which is Gravit-writable and would drift
from the operator-owned file. A channel with no roster entry yet (created
straight through the registry, before a listing has seeded it) reads as "no
roster yet" and refuses; an unparseable `channels.json` reads as "no rosters"
and refuses every call — fail CLOSED, *within a resolved channel*. What
happens when there is no channel to resolve in the first place is honest
limit 2, below.

**Deleting a channel** needs no new route and no button: remove the
directory (Gravit's own write map, or the operator's shell), then call the
host's `workspace/delete` Remote with `{request: {workspaceId}}` — there is no
UI for this second step yet. `/api` needs the browser cookie now, so the
simplest caller is the signed-in page's developer console:
`(await import("/client/js/wire/api.js")).call("workspace/delete", { request: { workspaceId: "<id>" } })`.
Order matters: `workspaceRegistry.create` rejects a nonexistent path, so once the
directory is gone the reconcile can no longer resurrect the record. `delete` never
touches the directory or the session logs; the channel's sessions simply fall into
`ungrouped`.

### The honest limits — the roster is a menu, not a fence

Charter Rule 3 requires recording a residual rather than shipping a guarantee
that fails at code level. In the same register as the Gate-2 note further
down this file:

1. **dsh tool registration is tree-wide.** There is no per-session scoping
   seam — `tools.register` (`registerTool` in `panelDeps`, `src/panels.ts`)
   publishes one flat name per bin (`agent_<bin>`, `toolNameFor` at
   `src/agents.ts:84`) that every session sees. A non-member agent's SCHEMA is
   still visible in every channel; only the call is refused.
2. **The roster check only runs inside a resolved channel — a session in NO
   channel is not roster-checked at all.** `agent_<bin>`'s `execute` reads
   `const channel = await deps.channelFor(cwd)` and gates the entire roster
   read behind `if (channel !== null)` (`src/agents.ts:469-470`); when
   `channel` is `null` there is no `else`, and control falls straight through
   to `runAgentRecipe` — every connected agent callable, unconditionally. This
   is deliberate, not an oversight: `channelFor`'s own comment says "the
   caller fails open either way" (`panelDeps`, `src/panels.ts`), because there
   is no roster to consult and tools are registered tree-wide regardless of
   channel. It is also cheap to reach, not a rare edge case: the old chat page's
   **`choose a local folder…`** row created a session straight from a raw
   `cwd`, never a `workspaceId` (`showStrategyPicker`; the gravit-ui client's New message
   offers channels only, and a create with no channel lands in the host's
   default directory, which no channel claims either), so
   such a session resolves to no channel and is never roster-checked; a channel directory
   that exists on disk but has not yet been through a reconcile lands in the
   same place.
3. **Gravit has a shell.** One shell turn can invoke `claude` directly. This
   roster is a MENU, not a fence — it reduces noise and states intent; it
   does not contain.
4. **One un-escalated shell turn can `curl` `POST /data/channels/agents` —
   no approval card, no git diff, no session event.** The sandbox confines
   FILE effects only: the emitted Seatbelt profile is `(allow default) (deny
   file-write*)` plus write allow-lists (`seatbeltProfileArgs`,
   `node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js`), and
   `dsh-bash-sandbox`'s own README says the modes "govern file effects only —
   network stays unrestricted". `/data` is a REACHABILITY FENCE, not
   authentication: `src/http.ts` (`isTrustedDataRequest`, moved there from
   the removed `src/data.ts`) — "A request with no Origin (curl, the tests,
   …) passes on Host alone" — and it stays fence-only at 0.2.0-rc.2
   (D8). Verified against the running face at 0.1.1: a `curl` POST to
   `/data/strategies` (this route's name before the rename to
   `/data/channels`; the fence itself is unchanged) cleared the 403 and the
   415 and reached the handler, refused only by name validation, while a
   forged `Host` still 403'd; a `curl` RPC `workspace.list` returned the real
   registry, HTTP 200. dsh 0.2.0 closed that second half against a bare
   `curl` — `/api` now answers 401 without the browser cookie — but not
   against a determined shell turn: the cookie is an HMAC over its payload,
   keyed by the signing secret in `$DSH_HOME/.credentials.yaml`, and the
   sandbox lets a shell READ that file (dsh-client-connection's
   `browser-auth`; stated from the code, not drilled). This is not
   introduced here — `POST /data/agents/connect` (`src/panels.ts`) already
   writes `$DSH_HOME/face/agents.json` and registers a tool live by the same
   path, and predates this design entirely. **The mitigation is visibility,
   not prevention**: a roster write appends a dated line to a durable face log,
   `$DSH_HOME/face/roster.log` (`src/roster.ts`'s `logRosterWrite`, called
   from the `POST /data/channels/agents` handler in `src/channels.ts`), naming
   the workspace, the resulting agent list and an ISO timestamp, so a change
   is SEEN even though it cannot be stopped. Building a token for `/data`
   would be new face security machinery against the charter's §7.4; dsh now
   ships one for `/api`, and putting `/data` behind it too is D8's open
   alternative. Recording this is what Rule 3 actually asks for instead.

**Two residuals, out of scope, recorded per Rule 3 (spec §10).** Neither is
caused by this change; both are recorded because it touches their
neighbourhood:

1. **An MCP server is a child of the face PROCESS, not of a session**, so its
   writes never pass `ctx.sandboxPolicy`. Evidence on disk, then: the Alpaca
   server of the time wrote `data/.screen_cache/` at the repo root during
   2026-09-02 strategy work, with no approval card; today the Account seat
   writes its key file into the Account's home the same way.
2. **`system-prompt.persona` was empty** — `''` in `dsh-base` and set by
   neither `src/overlay.ts` nor the operator's `cordis.patch.yml`, so the
   model was never told it was Gravit. Closed since: `composeFace` sets it
   from `dsh/profile/persona.md` (at 0.2.0 the key is `personaPrefix`; see
   "The profile").

## Discover (src/panels.ts + client/js/host/discover.js + client/js/render/discover.js)

**Discover** (`#/discover`, in the rail's first level) is the inventory of what Gravit runs —
there is no shop: nothing to install, buy, publish or count. Entering it reads five face routes
(the fifth, Research's, below), each alone — a failed one says `Couldn't read <Shelf>` with Retry beside the others drawn:
**Data**, the MCP servers and their tools (`GET /data/plugins.json`); **Bots**, the operator's
voices (`GET /data/bots.json`, never Gravit's own composition); **Agents**, Gravit first, then the
local CLI agents (`GET /data/agents.json`); **Skills**, Gravit's standing knowledge (`GET
/data/memory.json`). A search box matches names and lines across the shelves, `See all` opens a
shelf as a grid, and every card opens its item's page, `#/plugin/<id>`, under a namespaced id
(`mcp:<server>`, `bot:<id>`, `agent:gravit`, `agent:<bin>`, `skill:<name>`). Discover's refusals
go to its own status line. (The old chat page's master rail and its four sidebar faces —
strategy, agent, memory, plugin — are gone with that page; their `/#agent`-style links open
Messages.)

**Research**, the fifth shelf, drawn second after Data, is the six Lunhui modules in the chain's
order — Environment, Sentiment, Theme, Leader, Mode, Counterevidence — read from `GET
/data/modules.json` (plan 1 of the module cards, a projection of the runs card's rows) and drawn
as a grid of six, never a scrolling row, under `Lunhui · 6 modules`. The six cards are always
there, from the client's one table (`client/js/host/modules-view.js` `MODULES`); the listing only
fills their chips. Each card is its 副题, its role and the channel it reads (`cn-market`, `a
strategy`, or both), and a chip reading that channel's latest run alone: the headline words, `not
evaluable · <sources>` when the artifact is NOT_EVALUABLE, `not run` when the latest run holds no
artifact of the module, `no run yet` when no channel it reads has a run — never an older run's
artifact. A strategy card's chip names its channel (`lunhui-s01-repair · WAIT`), `not run` too
(`lunhui-s02-rotation · not run`). When the listing
says `mounted: false` the shelf says `Lunhui rows not mounted` and its cards dim, their chips grey
but still worded. A card opens `#/module/<name>`.

**Run**, on a card or its page, opens the module's Run sheet (`client/js/host/run-sheet.js`, its
words from `run-sheet-view.js`): **Where** (fixed on `cn-market` for a market card, a strategy for
Leader and Mode, either for Counterevidence), **On** — `Latest run` or `New run` (the three market
cards and Leader), a pick the run cannot take greyed with its reason (`theme already there`,
`needs Leader, then Counterevidence, on this run`, `mode already registered on this run`, `run no
longer the latest` — the last picked again to take the newest run) —, **Cites** for
Leader (the two newest sealed `cn-market` runs; read-only for Mode and a strategy's review),
**Stocks** for a Leader New run alone (1–4 main-board codes, empty for Gravit's pick; hidden on a
Latest run, whose message has no slot for codes), Theme's boards line, a
**Note to Gravit**, and what it writes. **Run** sends Gravit one message in that channel as a new
conversation `<Title> · MM-DD` — the composer's own `session/create`, `session/rename` and
prompt, the text the spec's Appendix B line (`请只跑 Lunhui 的 … 模块`), read by Gravit's
`lunhui:module` section; the face starts no role and calls no Lunhui tool — and the page moves to
it. While it runs the card's chip reads `Running · <title> ›`, a link to the conversation, and
Run is off; when the session stops the chip reads the listing again (re-read at once and 5 s
later). This browser remembers the Runs it sent (`localStorage["gravit-face.module-runs"]`) only
as a convenience.

- **Gravit** (the first card on Agents) — its page is three cards over three reads:
  `session/modelCatalog`'s `default` (provider, model and reasoning effort — the selection a new
  session starts from, i.e. the D2 row), the face's own `/data/host.json` (`{cwd, home,
  attachedSessions, version}` — dsh 0.2 has no `host.describe`), and `credentials/describe` for
  `DEEPSEEK_API_KEY` alone since 2026-10-24 (`Present` or `Absent`, never a value; the face
  reads no other key). Each card reads `Loading…`, `Couldn't read` alone on a failure, or its rows.
  `settings/describe` is not called: it needs the `profileContext` the face does not provide (D1).
  A session's usage — the `session/control` stream's `tokenUsage` and `contextPressure` — is in
  that conversation's Details.
- **Local agents** are an OPERATOR-CURATED roster, not a fixed list: it starts empty and lives in
  `$DSH_HOME/face/agents.json`. The Agents shelf lists what is *connected* (`Connected`; a
  connected binary that stops answering stays listed, `Not found`, rather than vanishing) and
  what auto-discovery *found on this machine* (`Found · <version>`) — the panels.ts suggestion
  list, fifteen coding-agent CLIs by their PATH names, each probed with `<bin> --version`
  (execFile, no shell, scrubbed env, 3 s kill; absent, hung and nonzero all read as "not here"),
  offered in list order when it answers and is not yet connected. **Rescan** forgets the
  one-minute probe cache and looks again (`POST /data/agents/rescan`). An agent's page is its
  directory entry — Version, Sign-in (`Signed in`, `Not signed in` or `Unknown`, read through the
  agent's OWN status command, `claude auth status`, `codex login status` or `hermes status`, the
  last a config report rather than a login gate, so a pinned provider reads as signed in — never
  its credential store) and the tool it became — with **Connect** for a found one or
  **Disconnect** for a connected one. `POST /data/agents/connect` admits a binary ONLY if it
  answers `--version` (the name is fenced to one bare PATH token, so a request body can never
  steer a probe to a path) and probes fresh; a refusal (`binary did not answer on this machine`)
  lands on Discover's line; `POST /data/agents/disconnect` removes a row. The gravit-ui client
  offers no connect-by-name for a binary the suggestion list does not know (the route takes any
  bare PATH token).

  **What a connection is FOR.** The face has no run box of its own: a
  connected agent the face has a recipe for is registered in the dsh tree as
  a tool, `agent_<bin>` (`ctx.tools.register`, synced at boot and after every
  roster write, disposed on disconnect), so **Gravit calls it from any
  channel that offers it on its roster** (see "Channels" above) —
  `agent_claude(prompt, resume?)`. The tool spawns the
  operator's own UNMODIFIED CLI as a child in the calling session's directory
  (`exec.agent.session.header.cwd` — the strategy's workspace), forwards the
  call's cancellation to the child, and hands the answer back as the tool
  result with the CLI's session id, so Gravit can continue the conversation
  with `resume`. These are the GREEN rows of
  `docs/research/2026-09-01-agent-connection-survey.md`: the child performs
  its own sign-in and the face handles no credential at any point, which is
  what keeps it on the permitted side of Anthropic's terms (the survey quotes
  the line and its source); the Hermes-style reuse of
  `~/.claude/.credentials.json` against the raw API is the bright line and is
  never ported. Recipes: Claude Code = `claude -p --output-format json
  --restricted --strict-mcp-config --disallowedTools "Read(./.env)"
  "Read(./.env.*)"` (no command/code tools, no WebFetch, user/project
  settings and every MCP config ignored, file tools confined to the run's
  directory, the workbench's key files unread — a READER, not an actor);
  Codex = `codex exec --sandbox read-only --json --skip-git-repo-check -o
  <scratch> -` (the sandbox is PINNED — the operator's `~/.codex/config.toml`
  says workspace-write and a recipe must not inherit its posture from a file
  the face does not own). The prompt always travels on stdin (an argv
  beginning with `-` would parse as a flag); the child's env is scrubbed of
  every credential override and endpoint redirect that would move a CLI off
  its own sign-in (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL`,
  the Bedrock / Vertex / Foundry switches) and of the workbench's own secrets
  — probes run under the same scrub, so the auth card observes what a call
  will get. Runs are one at a time per agent (a second call is refused while
  one is in flight), ten-minute kill with SIGKILL after a five-second grace,
  16 MB output cap. A tool call runs under the session's normal policy — like
  the seat's reads it raises no approval card; a `tools/pre-execute`
  `ask` hook is the knob if the operator ever wants one per delegation.
  Hermes deliberately has NO recipe: its default provider config reuses those
  tokens, so it stays a directory entry until its provider is pinned.
  The **Bots** shelf indexes the operator's own voices, one directory each under `bots/`, and
  Discover's head carries **Create a bot** (see "Bots" below).
- **Skills** — the wire's `skills/list` is addressed by a session and carries no SKILL.md body
  or pack, so two face routes read `ctx.skills` in-process: `GET /data/memory.json` (grouped by
  pack — the directory under `dsh/skills/`, mechanics first) and `POST /data/memory/skill`
  (`{name}`, kebab-validated). A skill's page is its group, its description and its full
  SKILL.md body as text, read once when the page opens.
- **MCP servers** — `GET /data/plugins.json` projects `ctx.loader.entries()` (the same short
  projection `dsh-host-plugin-inventory` makes — at 0.2.0 a `pluginInventory/list` Remote and an
  exported `readPluginInventory(ctx)`, mounted only by dsh-web-app; the face restates it rather
  than mount a row) plus `ctx.tools.schemas()` grouped under each `dsh-mcp-client` row's
  `serverName`. A row's `options.config` is never serialized — an MCP row's env block may carry
  a key; `serverName` is the one field read. A server's page is its state (`Pending`,
  `Loading`, `Active`, `Failed`, `Unloading`) and its live tool table, each tool's description
  clamped to two lines (a server may describe a tool with a whole method list — AKShare's run to
  thousands of characters). The composed row tree the listing also carries (`rows` — about 110 at
  0.2.0-rc.2, ids of the form `include:<row id>`) is not drawn; it is in the JSON.

Every `/data` route — Discover's, the
Account proxy's and the seat box's, the channel, bot, room and session routes —
stands behind a browser-trust fence modelled on the one the harness
puts in front of `/api` (`isTrustedDataRequest`): a loopback Host, no
Fetch-Metadata `cross-site`, and a present `Origin` that matches the Host —
and, unlike `/api`, behind nothing else: no browser cookie (D8). Every `/data` POST
additionally requires `application/json` (415 otherwise), so a cross-site
page cannot reach a side-effectful route with a "simple" request that needs
no preflight. The roster's connect/disconnect are the only writes to face
state (its own metadata file); an agent tool spawns that agent's own CLI
with a fixed argv and writes nothing durable of its own — a Codex call gets a
`mkdtemp` scratch directory under the OS tmpdir for `-o`, read once and
removed when the run ends. `panelDeps` fails loud at boot when
`skills`/`tools`/`loader`/`workspaceRegistry`/`agents` are missing from the
tree — a dead shelf with nothing on stderr is the failure mode it exists to
prevent.

## Bots (src/bots.ts + src/bot-presets.ts + plugins/bot.js + bots/)

A bot is a dsh **agent preset** the FACE declares: one directory under `bots/`
holding `agent.cordis.yml` (its composition), `preset.yml` (`name`,
`description`, optional `model`), `SOUL.md` (the persona SOURCE), `skills/` (its
stance pack, a dsh skill root) and `journal/` (the one directory it may write,
from its home). dsh 0.2.0 scans no directory and reads none of these files —
its preset registry (`@deepseek-ai/dsh-agent-preset-registry`, the overlay's
`agent-preset-registry` row) takes only the definitions a plugin hands it — so
the face builds each definition from `bots/<id>/` itself (`src/bot-presets.ts`),
and the declaration only ever READS those files; the authoring routes below are
their only writer.

- **`bots/gravit` is the default** every session joins when it names none, and
  its composition is not read from the directory: the face RENDERS it from
  `roles/` at compose time ("Roles" below) — the face's `plugins/gravit.js` row
  (the `deployment:today` section, the role list, the cycle contract and the
  `lunhui:run` and `lunhui:module` protocols, scoped to Gravit's sessions and never a bot's), then one
  `@deepseek-ai/dsh-tool-subagent` row per role. None of them masks a host
  tool, so Gravit's own roster is the host's flat roster plus the `role_<id>`
  tools (`role_cn_market_analyst` today), and a bot's carries none (`bots-smoke.test.ts` pins both, and the
  date, the cycle contract and the protocol in Gravit's prompt alone).
  `bots/gravit/preset.yml` still supplies its display metadata; its
  `agent.cordis.yml` is the generated mirror of that render, for readers. The
  default is the overlay's static `preset-gravit` row, built by `definitionFor`
  at compose time, so it exists before the first `session/create` resolves it.
  The face also declares `preset-kairos`, the same definition under `kairos`,
  Gravit's id before 2026-10-08: archived sessions persist it and dsh refuses a
  preset no row declares. It has no directory and never appears among the
  bots; `kairos` and `gravit` are both reserved ids.
- **Every other bot is declared after the tree has settled** — after the MCP
  rows' first discovery and the boot audit — by `declareBots`, one child plugin
  of the root per bot, which is the registry's own declaration model. The
  timing matters because a declaration activates AT ONCE: declared any earlier,
  `plugins/bot.js` would mount before the host's late tools existed. Only
  directories whose names pass `isBotId` are declared, so never `_template`,
  and a bot the repository does not carry cannot exist: nothing else the
  face composes declares one.
- **Rebasing.** dsh resolves a preset's rows against the DECLARING context's
  base — the profile directory — where 0.1.1 resolved them from the preset's
  own directory. `definitionFor` therefore rebases every `./` or `../` row and
  every absolute path row to an escaped `file:` URL against `bots/<id>/`
  (recursively inside `group: true` rows), and a relative `customSkillDirs`
  entry of a `@deepseek-ai/dsh-skill-filesystem` row to a path under
  `bots/<id>/`. The last one changes behaviour: at 0.1.1 `./skills` resolved
  against the process cwd, `face/`, and scanned a directory that does not
  exist; it now scans `bots/<id>/skills`, which today holds only a README.
- **`preset.yml` is read exactly as 0.1.1's dsh read it**: `name`,
  `description` and `order`, trimmed, a blank value omitted; an absent or
  malformed file is empty metadata, and the bot still declares. `model` stays
  face-only — a dsh preset carries no route.
- **A composition the face cannot read** — missing, unreadable, not YAML —
  leaves the bot undeclared: the reason, with the file path, goes to stderr
  and `/data/bots.json` shows the bot `broken`. A readable composition that is
  not a list IS declared, and the registry lists it broken in its own words.

`bootFace` refuses to start if the registry service is missing, its default is
not `gravit`, the roster cannot be read, the default preset is absent or
broken, or a bot the face declared is not listed: every `session/create`
resolves a preset, so a roster that cannot supply one would fail every session
instead of the boot. A bot that merely fails to declare does not stop the boot
(0.1.1 listed a broken bot and started too).

**Saving re-declares.** dsh 0.2.0 never re-reads `bots/<id>/` (0.1.1 re-read it
on every mount), so every create, settings or soul save re-declares that bot's
preset — dispose, then declare, serialized per bot — before the route answers.
Conversations already running keep the revision they joined; new ones get the
saved files, with no restart. A superseded revision is disposed by the
registry once no live agent uses it. Two edges:

- **The redeclare window.** Between the dispose and the new declaration, a
  `session/create` or a room member naming that bot fails
  `agent-preset/not-found`. That is upstream's model — the registry refuses a
  duplicate id, so the old declaration has to go first.
- **A failed re-declaration** answers `500 bots/<id> was saved, but the
  running face could not re-declare it (…); restart the face to load the
  saved files`: the files ARE saved, and a restart declares them.

**Gravit is the host plane; a bot is a mask.** Gravit is told who it is by the
`system-prompt` row's `personaPrefix`, set from `dsh/profile/persona.md` by
`composeFace` (charter decision D11, closed; a malformed template refuses the
boot with the file named — `readPersona`). A bot's composition names one
face-owned plugin, `plugins/bot.js` (`gravit-bot`), which registers the bot's
persona as a scoped `deployment:persona-prefix` section — shadowing Gravit's
for that preset's agents; the face sets no persona suffix — and an
**allow-list** `tools.restrict`. Allow, not deny: dsh admits later-registered
globals through a deny mask and excludes them through an allow mask, and the
two tools a voice must never see that are registered *after* the mount —
`agent_<bin>` on connect, `dispatch` in the rooms arc — are excluded by the
allow form without being named. `mcp__…__place_order` is excluded by OMISSION
from the list. `mcp__*__<raw>` in the list expands against the live tree
(`expandAllow`), so the operator's server name does not matter.

Because a preset activates when it is declared, not at its first session, the
mask FOLLOWS the tree: `bot.js` re-expands the allow list after every burst of
`tools/change`, one coalesced pass per burst (a synchronous pass per event
blocked the event loop for about a second on an unregister burst with 10 bots
and 45 tools). An allow-listed tool that registers later — an MCP server that
connects late, or reconnects under the same names — is admitted; a tool no
allow list names never is. Names the tree does not have are warned once, at
the mount. A bot whose FIRST mask is empty throws, and the registry marks that
revision broken for good ("a mount failure is final"); a save or a restart
recovers it. A later re-expansion that fails keeps the mask in force.

**The mask is visibility, not authority.** dsh says so of every scope ("live visibility
composition, not an authority boundary"). What a bot may write is its session's sandbox mode;
what it may order is Gate 2, which is tree-wide. Neither changes when a bot is masked, and
neither is containment. At 0.2.0 a `read-only` session's refused write also carries dsh's
escalation hint (`[sandbox: escalation available — retry this exact command once with
sandbox_permissions …]`), inviting a voice to retry once and raise an approval card — which
only the operator can grant.

**Authoring is the face's own copy.** **Create a bot** (Discover's head → `#/discover/create`:
Name, Id, Description, Model, Soul; `POST /data/bots`, which answers `{ok, bot: <the new row>}`
and opens its page) copies `bots/_template`, writes `preset.yml` and `SOUL.md`, and RENDERS
`agent.cordis.yml` so the persona row's text is the soul's (`renderComposition`) — dsh's
`!!js` cannot read a sibling file. A bot's page on Discover has **Edit**: name, description,
default model (`Default`, or a route `session/modelCatalog` offers — one it does not offer but
the bot names is still listed) and SOUL together, through `POST /data/bots/settings`. (The old
settings page's role guide, which drafted a soul from six answers, is not on the gravit-ui
client; `client/js/wire/botSettings.js` `draftBotSoul` remains.) Creating without a SOUL
replaces the template's `<bot name>` with the chosen name.
Saving updates the persona inside the existing composition, preserving other plugin rows,
paths, allow patterns, and skill configuration. The legacy soul endpoint remains supported.
The parser uses the Loader's own entry-list schema (`entryListSchema`) so `!!js`
expressions round-trip without evaluation. An entirely dynamic bot config must be edited by
hand; SOUL saving refuses it with 409. An unparseable composition retains the legacy repair
behavior of rebuilding template rows. Same-bot reads and writes serialize; the page supplies
the saved-file revision it was drawn from, and a stale save returns 409 — the page reads it as
`Changed elsewhere — reloaded`, reads the bots again and shows the saved revision's values (every
box's id carries the revision, so the typing that lost the race is not restored); a 500 `bots/<id>
was saved, but the running face could not re-declare it …` kept the files and counts as saved.
Files are staged before replacement, with rollback on ordinary I/O failure; this is not a
crash-safe multi-file transaction. A hand edit to `SOUL.md` reaches nothing until the face saves
it again. The page shows the setup issues the face found and a broken bot's reason (`Can't run ·
<reason>`); source/persona drift (`soulInSync`) is in the listing and not drawn. No `{{` anywhere
in a soul: the
prompt is a strict template with no escape, and both write paths (`rejectSoul`, on the way
in) and the plugin itself (`validateBotConfig`, at mount) refuse it.

**A bot's home** is a session created with `cwd = bots/<id>/journal` and `agentPreset = <id>`
— **Talk to <bot>** on its page opens its newest home conversation that is not archived, else
creates one with exactly that cwd and preset (`session/create {cwd, agentPreset}`; not offered
for a broken bot or one the preset roster does not list) — and the host's own `session/create`
mounts the preset (no in-process agent creation). The list groups a bot's home sessions under
the bot, each with the bot's letter, from the session's preset, which
0.2.0's `session/list` rows no longer carry: `client/js/wire/summaries.js` `summaryOf` restores it
from the row's `agentPreset` projection first, then from `/data/channels.json`'s `presets`
(built from the persisted and live session headers), and leaves it absent rather than
guess (`client/js/wire/grouping.js` `bucketFor`, `BOT_KEY_PREFIX`, ordered by
`client/js/host/list-view.js` `groupsOf`; `kindOf` in `client/js/host/sessions.js`). Reading the
same preset, the transcript names the voice: in a bot's home session the assistant's replies are
the bot's, under its letter (`client/js/host/kinds.js` speaks the assistant role as the bot);
the composer still reads `Tell Gravit…` there. Ids keep the retired 0.1.1
preset grammar `[a-z0-9][a-z0-9-]*`, bounded to 64 code points (`BOT_ID_RE`) — dsh 0.2.0
asks only for a non-blank id, so this is the face's own gate. A blank Id is left to the face,
which proposes one from the display name; the page refuses before posting a name that proposes
none — no ASCII letter or digit — and has no id (`Give it an id: a-z, 0-9, -`), through
`client/js/wire/botId.js` `proposeBotId`, the browser twin of the server's (`botId.test.ts` pins
that a non-empty proposal is always an id `isBotId` accepts), and the server refuses anything
else — `gravit` by name (`RESERVED_IDS`) and `_template` by the
grammar, which admits no leading underscore (both through `isBotId`).

**Default model and inspection** (`src/bot-runtime.ts`). **New test conversation** uses
saved settings, with the actual session created on the first message. Unsaved edits disable
that button. A bot's `provider/model` seeds its home session's first request without changing
the host default; subsequent requests inherit their own logged model, and a saved route the
tree does not serve fails that first request (`Bot model <route> is unavailable. Update the
saved route and start a new conversation.`). Room model
selection stays with the room engine. The face seeds through its own prompt-assembly and
request hooks, never through dsh's `session/selectModel`, whose default save persists nothing
in this tree anyway (D2). A model selected over the wire (`session/selectModel`) before a
bot's first request is superseded by that bot's saved initial route; the face has no such
model-switch control.
Which preset a session runs is read from dsh's `agentPreset` projection, which follows an
`agent-preset/selected` re-selection, not from the header's creation-time value.

The page lists configured tool patterns and local skill declarations separately from
**Session inspection**. An idle live session is assembled under `runMaintenance` to show
its mounted persona, model and tool schemas; its last actual request is labelled separately
and read from `request/header`. During a turn, inspection reads captured persona and logged
request facts without assembling. Cold sessions are never resumed just to inspect them.
The saved revision and startup revision are diagnostics, not claims that every part of a
request is frozen. Resuming after a host restart mounts the bot's current declaration.

**Journal context** (`src/bot-journal.ts`). Before every bot request, the runtime reads that
bot's own `journal/notes.md`, in both home and room sessions. It is a separate `bot-journal`
context section, not part of SOUL: historical notes to check against current evidence, not
new instructions. Reads are bounded to 12 KiB, reject symlinks, and report missing, empty or
unavailable notes without blocking the request. Inspection shows the status, content revision
and truncation flag. dsh 0.2.0 persists the assembled context as a runtime-context snapshot —
a `user/message` whose source is `{kind: 'runtime-context', form: 'snapshot', sections}` —
with a `bot-journal` section. An edited journal refreshes on the next request; this hook
neither writes notes nor retrieves other channels' conversations.

| Route | What |
|---|---|
| `GET /data/bots.json` | every directory in the grammar under `bots/`, with dsh's roster merged in: `broken` reasons shown — dsh's, or the face's own when it could not declare the bot — and a directory the roster does not report flagged `listed: false` (Rule 5) |
| `POST /data/bots` | create — `{name?, id?, description?, model?, soul?}`, the id the one given or `proposeBotId(name)`; 400 an id outside the grammar or a soul carrying `{{`, 409 exists, 500 `_template` missing. The new bot is declared before the route answers (a failed declaration: 500, files kept); the returned row itself reads `listed: false` (it is built without the roster), and the next GET reports it listed |
| `POST /data/bots/soul` | `{id, soul}` — rewrites `SOUL.md` and the composition together, then re-declares; 400 a bad id or a soul carrying `{{`, 404 unknown bot |
| `POST /data/bots/settings` | `{id, revision?, name?, description?, model?, soul?}` — omitted fields stay unchanged, `model:null` inherits the default; re-declares; 409 on a stale revision |
| `GET /data/bots/runtime?id=…&sessionId=…` | live mounted preview or last-request facts, with a separate saved-SOUL comparison; unattached sessions return unavailable |

All stand behind `isTrustedDataRequest` (403), the POSTs behind 405 / 415 / 400 for
method, content type and body, with a 64 KiB body cap because a soul is prose.

**Deleting a bot** is `git rm -r bots/<id>`; there is no button. The running face keeps the
declaration until its next restart; after that the preset is gone, its sessions remain
readable history, and resuming one fails `agent-preset/not-found`.

**No client can author a bot.** dsh 0.2.0's registry exposes three Remotes —
`agentPresets/list`, `agentPresets/read`, `agentPresets/select` — and no authoring one, so
the face's routes are the only way into `bots/`, and the 0.1.1 `trust: "system"` setting,
which disarmed dsh's own copy/remove/openDocument RPCs, has nothing left to disarm. What a
signed-in client CAN do: `agentPresets/read` returns a preset's composition YAML — the bot's
persona and this install's absolute, rebased paths — and `agentPresets/select` re-points a
session that has not started its first turn to another preset (`agent-preset/locked`
after). The face offers neither in its UI, and the room's `dispatch` refuses a session whose
header OR `agentPreset` projection names a bot.

**A bot in a room** — dispatched by Gravit, addressed by the operator's `@`, its answers in the
room's transcript in its own voice — is the "Rooms" section below. What is still not built (spec
§11, on purpose): bot-to-bot messaging outside a room, cross-channel conversation retrieval,
automatic journal writing, a delete button, a channel-scoped 1:1 with a bot.

## Roles (roles/ + src/roles.ts + plugins/gravit.js)

A role is a prebuilt delegated task. Gravit calls it by tool name, `role_<id>`; a one-shot
child runs the brief with the role's own persona and exactly the role's tools, and its report
comes back as the tool's result. It is not a bot — no journal, no home session, no seat in a
room, never listed among `bots/` — and not a bare `subagent` call, where the model picks the
persona and the tools on every call: here both are fixed on disk. Three ship: `cn-market-analyst`,
the Lunhui market modules' analyst, which writes the one module a brief names and all three when
none is named (spec 2026-10-28 F6), `cn-reviewer`, the counterevidence reviewer, and
`cn-stock-analyst`, the leader and mode modules' analyst ("Lunhui analysis"). The three that shipped before (a screener, a backtester and a reviewer, whose
allow lists were the removed Python package's tools) retired with their tools on 2026-10-24, and
new roles are the operator's to design; `roles/_template` is the copy source and never a role, so
Gravit's preset today is the `gravit` row, `role-cn-market-analyst`, `role-cn-reviewer` and
`role-cn-stock-analyst`.

One directory per role under `roles/<id>/`:

| File | Owner | What |
|---|---|---|
| `ROLE.md` | the operator | the child's persona; at most 2,000 bytes, no `{{` (the prompt is a strict template with no escape); `_template`'s ends on the four report headings — status, what was measured, paths, limits |
| `role.yml` | the operator | `name`; `description`, ONE line of at most 300 characters — the summary Gravit reads when it chooses a role; `allow`, the child's tools by EXACT name; optional `model: <provider>/<model>`, the route that role's children run on (it becomes the row's `agentOptions`; unset, a child runs on its parent's route) |
| `README.md` | — | `_template` only: the contract, for whoever copies it |

The id is the directory name, in the bots' grammar `[a-z0-9][a-z0-9-]*`. The tool is `role_` plus
the id with `-` as `_` (`data-check` is `role_data_check`), at most 64 characters — dsh caps
nothing, a model API may — so an id over 59 characters is refused. Keys of `role.yml` the face
does not know are ignored.

**Adding or changing a role** is a file edit by the operator. Gravit may propose one in
conversation and never writes under `roles/`; there is no UI. Copy `roles/_template`, edit the two
files, run `cd face && npm run render:roles`, run `npm test`, commit both, and restart the face:
nothing reloads `roles/` while it runs.

**How the face reads them.** `composeFace` calls `readRoles` (`src/roles.ts`) at every boot and
renders Gravit's default preset from the result in memory (`gravitRows`):

- the `gravit` plugin row, whose config `roles: [{tool, summary}]` is what `plugins/gravit.js`
  turns into the `gravit:roles` prompt section — a paragraph on what a role is and why its
  report is a claim to check, then one `- role_<id> — <description>` line per role, one past
  dsh's own subagent section;
- one `@deepseek-ai/dsh-tool-subagent` row per role: `provider: spawn`, `toolName: role_<id>`,
  `backgroundMode: one-shot`, `persona` (the `ROLE.md` text), `toolFilter: {allow: […]}`, and
  `agentOptions: {provider, model}` when `role.yml` names a route. That package has no
  description key, which is why the summaries ride on the plugin row.

A role the reader cannot accept refuses the compose, naming the file and the rule — the roles
directory missing, a symbolic link under it or a directory there whose name is not an id, a
`ROLE.md` that is missing, empty, over 2,000 bytes or carrying `{{`, a `role.yml` that is not a
YAML mapping, a blank `name` or `description`, a description over one line or 300 characters, an
empty or malformed `allow` or one that lists a name twice, a bad `model` — so a face never boots
with half a role library. A hidden entry or a plain file under `roles/` is skipped. A face that
ships `bots/` therefore ships `roles/` beside it.

**The mirror.** `bots/gravit/agent.cordis.yml` is GENERATED by `npm run render:roles`
(`scripts/render-roles.ts`): the same rows under a "do not hand-edit" header, the plugin
spelled by its relative path. The face composes nothing from it (`listBots` hashes it into the
bot row's `revision` and parses nothing); `tests/roles.test.ts` byte-compares it with a fresh
render and fails while the two differ, so a role edit that skipped the script is caught by
`npm test`. It embeds `dsh/profile/cycle.md`, `dsh/profile/lunhui-run.md` and
`dsh/profile/lunhui-module.md` too, so an edit of any of them needs the script as well.

**Exact tool names.** An `allow` entry is a host tool name (`read`, `grep`, …) or
`mcp__<server>__<raw>`; a `*` is refused where the file is read. dsh applies the list as
`tools.restrict({allow})` inside the child's creation window, and `restrict()` checks every name
by set membership against the tools the child inherits — no glob, no prefix (the spec's first
`mcp__*__<raw>` expansion, as `plugins/bot.js` does for a bot, was dropped on that finding: spec
§11.1 (a)). An MCP tool therefore carries the server name the operator's profile mounts it under
(the face's own row mounts `account`, which a role may not carry anyway), and a
server mounted under another name means editing every role that names its tools (the `NEVER` table
of `src/roles.ts` refuses the account and order names under any server name). Whether a named tool
exists is a fact about the tree at the moment a role is CALLED, not about the file, so the boot
checks nothing: a role that names a tool the tree lacks — its server unmounted, unable to start,
or out of reconnect attempts — fails THAT delegation with `tools.restrict() names unknown global
tool "…"` and creates no child.

**What a role never carries.** `readRoles` refuses an `allow` entry that is: a tool that needs a
human (`ask_user_question`, `exit_plan_mode` — a delegated child has no one to ask, and dsh
refuses `ask_user_question` to it with `DELEGATED_CALLER`); a web tool (`web_search`,
`web_fetch`); a delegation tool (`subagent`, `subagent_fork`, `send_message`, `interrupt_agent`,
`list_agents`, `workflow`, `ralph`, `dispatch`, any `role_*` or `agent_*` name); a goal or todo
tool; `run_code`, the reserved PTC transport, which `tools.restrict()` refuses to name; an account
or order tool under any server name (anything under `mcp__account__`, the seat's twelve writes,
and `account`, `positions`, `orders`, `place_order`, `cancel_order`, bare or as
`mcp__<server>__<raw>`, matched by raw suffix as Gate 2 matches — the seat is Gravit's); any
`mcp__akshare__` tool (an operator's own row) or `portfolio_akshare` under any server
name. The message gives the reason (the `NEVER` table).

**The job tools are a `bash` role's own.** A child's `bash` command runs under bash-sandbox's
60,000 ms default deadline; a call may pass `timeoutMs`, capped at 600,000. A command still
running at its deadline is not killed but moved to a background job, which only its child can
list, read or stop and which is cancelled with the child. A role with `bash` therefore carries
`job_output`, `job_list` and `job_kill` (and its `ROLE.md` should tell it to pass `timeoutMs` for
a long run and to read or stop a moved job before finishing); a role without `bash` carries none
of the three.

**What the child sees.** A delegated child JOINS the preset it was delegated from
(`applyChildComposition`, dsh's `dsh-subagent`), then has its own composition applied: its
`persona` becomes a child-scoped `deployment:persona-prefix` that shadows Gravit's; `restrict`
removes every tool the role does not name — the preset layer's `role_*` tools too, so a role
cannot delegate to a role; and `gravit:roles` lists only the roles whose tool the assembling
scope can call (`canCall` in `plugins/gravit.js`: `tools.get(name, scope)`, the gate dsh's own
web and subagent sections use), which for a role child is none, so it is never told of roles it
cannot call. A `subagent_fork` child, seeded with Gravit's turns and restricted by nothing, sees
every role tool and so reads Gravit's system prompt unchanged — the prefix its inherited history
was cached under. The `gravit:cycle` contract ("The profile" above) is gated the same way, on
`create_goal`, which no role's allow list can name: a role child reads none of it, a fork child
all of it. Both sections also read the session's header (`isRootOrFork`): a delegated child
that is not a fork — a plain `subagent` spawn, a workflow or ralph worker, restricted by nothing
and so able to call every role tool and `create_goal` — reads neither, since it inherits no
prefix to keep identical and `create_goal` needs a direct human turn on a top-level agent. The
`deployment:today` date reaches every child, and so does `GRAVIT.md`, in
the child's own `agent-instructions` baseline. It runs in its parent's cwd under a permission
scope fixed when it starts: dsh tells it that an operation needing an approval is rejected, so it
reports the limit instead. One thing is dsh's, not the face's: the child's prompt still carries
dsh's generic paragraphs for tools it lacks (`create_goal`, `workflow`, `ralph`, and for a role
without `bash` `job_output`), because those sections are global and ignore the restriction.

The `lunhui:run` and `lunhui:module` protocols ("Lunhui analysis") are gated the same way, on
`lunhui_read_run`, which no role's allow list names: a role child reads neither.

`roles-smoke.test.ts` pins the child's side on a real boot over two fixture roles made from
`_template`, and on a second, third and fourth boot the shipped `cn-market-analyst`,
`cn-stock-analyst` and `cn-reviewer` ("Tests" below); "The role drill" at the end of this file is
the live check, and the live market and strategy runs ("Lunhui analysis") the first that each
role meets.

## Rooms (src/room.ts + src/room-rules.ts + src/room-contract.ts + src/room-projection.ts + client/js/wire/room.js)

A room is an ordinary channel session whose agent is Gravit and which has **members**: one
session per bot the channel rosters, created lazily the first time that bot is named. Nothing
is created to make a session a room. The operator checks bots into a channel on its page
("bots in this channel", `POST /data/channels/bots`, at most six — `ROOM_CAPS.maxMembers`); the
roster stays a menu, not a fence (the channels section's honest limits apply verbatim).

**Gravit organizes the room through one tool, `dispatch`** (`to`, `mode` parallel or serial,
`brief`, `reason`). It is registered globally on the root context (`installRoom` in `main.ts`),
so it is in Gravit's roster; every bot's allow-list mask excludes it without naming it. The
call validates `to` against the channel's bot roster (the refusal names the roster), starts
the round, and returns at once — the result text names who was called, how, **who was not
called**, and tells the model to end its turn. Gravit is woken once per round, by a
`followup` that names who answered and who passed.

The brief accepts the existing string or an object with `question` and optional `context`,
`evidence` requirements, `falsification` terms and desired `output`. `src/room-contract.ts`
validates and formats both forms; the tool schema prefers the object for research questions.

**A member session** is created in-process by the engine (`ctx.agents.create`) with the
channel directory as `cwd`, `parentSession` = the room, `agentPreset` = the bot, the bot's
`preset.yml` `model:` when the tree serves it (else the default, with a line in the dispatch
result), and — inside the same creation `setup`, before the session is published — the
**`read-only`** permission preset: a bot in a room does not write files, by sandbox mode, not
by mask (D12). A member that already exists is resumed, never recreated. Members are runtime
roots (created from the root context, not from Gravit's), which is what lets a member ask the
operator a question.

**What a member sees** each turn: the room delta — every operator prompt, Gravit reply and
member answer since it last spoke, one attributed line each (`操作员:`, `Gravit:`, `<bot> (you):`,
`<bot>:`) — the brief, and standing rules carried in the prompt (reply with your view or
exactly `(pass)`; your original answer is retained in the room; this transcript covers this
room and any own journal is historical context; address the operator directly when the
judgment is theirs, write `@<bot>` to pull a peer in). Its cursor is
the delta prompt in its own log (`source.form === 'delta'`, `messageIds`), so a member never
re-reads what it saw. Parallel: everyone answers on the same delta and sees no peer this round.
Serial: each later member sees the earlier answers.

Members answer in their own voice, then are asked to append one terminal `room-view` JSON
fence: `position`, `evidence`, `uncertainties`, `changeConditions`, and `disagreements`
(`with` another roster id and `point`). Evidence remains a speaker's claim, not a verified
source. A member may name only disagreements with peer views it has actually seen; initial
parallel answers cannot invent them. Valid fields are extracted for display, while the raw
answer stays intact. Missing or malformed blocks fall back to the full text. Mentions inside
a valid structured block do not call peers. At round end, Gravit receives an attributed,
bounded comparison and instructions to distinguish factual, interpretive and risk-preference
disagreements before giving its conclusion and next check. An empty disagreement list does
not establish consensus.

**How a room fact is recorded — no `room/*` events.** dsh's persistence refuses to reload a log
carrying an event type outside its catalog (`KNOWN_SESSION_EVENT_TYPES`), so every room fact
rides a known event: membership is the member's header; the dispatch is the tool's own
call/result; an answer is a `user/message` on the room session with `source: { kind: 'room',
form: 'answer', bot, name, sessionId, turn, round }`; the round end is the waking
`user/message` with `form: 'round-end'` and every turn's state. Answer sources can also carry
`view`, `displayText` or `viewIssue`; the round-end source carries the structured `discussion`
with its brief, attributed views and unstructured speakers. These fields survive history
reload without introducing new event types — at 0.2.0 `kind: 'room'` is a native message
source of log format v4, so logs this engine writes reload. Logs it wrote under 0.1.1 do
not: 0.2.0's migration refuses a message source it cannot classify, and those room and
member sessions no longer open (upgrade decision D11; "Sessions written before 0.2.0"
below). Answers are **appended straight onto the room log** while no Gravit turn is open (a
bubble at once, a seq now, in the next request's history) and held in a per-room outbox
otherwise, flushed at the next `turn/end` and
before the round-end wake. The `room` projection unit folds these events into the coarse state
the strip shows (`called`, `answered`, `passed`, `failed`, `timed-out`, the round, `organizing`);
it rides the `session/control` stream's projection items, the follow snapshot and the
`session/list` row; for a cold room, `session/projections` answers it from dsh-base's
projection cache — at 0.2.0 one record per session,
`$DSH_HOME/storages/session_projcache/sessions/<id>.json` — without activating the room
(R13, cold rows listed `untitled`, stays closed: the list row's title comes from the same
cache).

**Caps, deadlines, endings** (`ROOM_CAPS`, one block): 3 rounds and 10 bot messages per
operator send, 2 peer continuations per round, 180 s base per member turn extended while the
member runs or has a gate pending, 1200 s hard cap → `agent.cancel` (inbox kept) → `timed-out`.
A member whose model fails is `failed` and counts as a pass; the round continues. A round ends
`settled`, `capped` (a cap stopped it) or `superseded` (the operator spoke mid-round: running
turns finish and land, nothing further starts) — three words for three facts. Every operator
send resets the caps.

**The operator's `@`** is deterministic and never passes through Gravit: the composer sends a
text containing `(^|\s)@` to `POST /data/rooms/say`, which resolves mentions against the roster
by id (by display name only when it is one token), appends the message to the room as the
operator's own (`kind: 'user'`, `mention: [...]`) without waking Gravit, and turns each named
member — one mid-turn is queued behind that turn, never refused. A text that names nobody comes
back `addressed: []` and the client sends it as an ordinary prompt. An `@` into a cold room
resumes it first, through dsh's own `sessionController.resolveAgent` (the host's composition
path, never one the face assembles); a room dsh cannot open answers 409 with dsh's code and
message — for a pre-0.2 log, followed by `it looks like a log written before dsh 0.2, whose
room messages the 0.2 migration refuses - the file stays on disk untouched`.
`POST /data/rooms/state` answers the roster, the members the engine drove this boot, and the
caps left.

**The client.** A member's answer renders as a bubble in the bot's own voice — its display name
over it and its letter — never as a context row (`client/js/wire/room.js`, `mapper.js`,
`client/js/host/kinds.js`): the room's `displayText` when the answer has one (the prose of a
structured answer, its valid JSON fence kept out), else its text, through the same markdown hook
as Gravit's. The round end is a room line. The old chat page also drew a **本轮讨论对照** card
after that line when discussion data existed (the brief, each speaker's position and supporting
details, declared disagreements, the speakers who supplied plain text only), disclosures on the
member bubbles (evidence, uncertainty, change conditions) and a **participants strip** above the
transcript (coarse states from the projection, fine ones from one `session/follow` per LIVE
member); the gravit-ui client draws none of the three. Its group head shows the members — a
cluster and their names — from the `room` projection and the list's fold, and no member session
is followed (following a cold session activates it, "The wire and the transcript"). A member's
question or escalation card renders **inline in the room**, under the bot's name, and is answered
against the member's own session. A member's answer that records its member session and turn
carries a **Trace** disclosure under it: opening it reads that exact turn — the projections cut,
then the history paged back as needed, never a follow — so it does not resume or prompt the
member; it draws the turn's context lines and words — never a tool call — with `Loading…`, the
loader's words or `No steps` (`client/js/host/traces.js` over `client/js/wire/member-traces.js`). Membership still
follows the header: `parentSessionId` set, no `origin`, a bot preset, the parent running the host.
A pending gate in a room counts toward the rail's Messages badge (the conversations with a card
waiting on you).

**The honest limits, in the register of the channels section.** Dispatch grants nothing and the
mask is visibility; a member's write fence is its sandbox mode, its order fence is Gate 2,
tree-wide (both proven from a bot session in `room-smoke.test.ts` and `bots-smoke.test.ts`).
Four voices on one model will tend to converge (R3); parallel first answers are the mitigation,
not a cure. Dispatch is Gravit's judgment (R2): it may under- or over-call; the "not called"
clause and the operator's `@` are the answer. A member's pending gate with no client connected
blocks until the hard cap (R6). A bot can read its own shared journal, but does not retrieve
other channels' conversations or automatically maintain those notes (R5 remains partial).

**A member session dsh 0.2 cannot open** — one written under 0.1.1 — fails only that
member's turn, recorded `failed` with the reason `<bot>'s member session <id> is unreadable
under dsh 0.2 (legacy format: …); it looks like a log written before dsh 0.2, whose room
messages the 0.2 migration refuses - the file stays on disk untouched; deleting that member
session gives <bot> a fresh one in this room (archiving does not: an archived session is
still found)`. Gravit reads it in the round-end text, the round's `turns[].reason` carries it,
and the face's console logs it; the round goes on with the other voices and still wakes
Gravit. The engine never creates a fresh member behind the operator's back — that would fork
the voice's memory (upgrade decision D11).

| Route | What |
|---|---|
| `POST /data/channels/bots` | `{workspaceId, bots[]}` — the channel's bot roster, at most six ids; 400 a bad id or over the cap, 404 no such channel, 409 a corrupt roster file; a dated `bots` line to `roster.log` |
| `POST /data/rooms/say` | `{sessionId, text}` → `{addressed: [...]}`; 400 a bad id or empty text, 404 not in a channel or no such session, 409 a corrupt roster or a room dsh cannot resume (dsh's code and message) |
| `POST /data/rooms/state` | `{sessionId}` → `{roster, members, caps, round?}`; never resumes a session |

## Temporary subagents (client/js/wire/subagents.js + client/js/host/children-view.js)

**On the gravit-ui client** the old **临时子任务** panel is a conversation's **Children**, a
section of its Details, in its minimal form: each direct child's label (`Subagent` for a
one-shot child without one), `One-shot` or `Continuable`, and `Running`, `Not running`, `Unknown`
or `Unavailable`, with **Stop** — asked twice — on a running continuable child; a malformed
catalog reads `Children unavailable`, never an empty list. A child's report reaches the parent's
thread as one centred line. Reading a child's transcript, its latest output and a human
follow-up are not on it. What follows describes the host's subagent stack, which holds either
way, and the old chat page's panel.

A temporary subagent is a delegated task with its own durable child conversation. It is
separate from the operator's named bots and the room roster: creating one writes no bot
profile or journal. Its label describes the work. The face uses the subagent stack already
mounted by `dsh-base`, with no second task registry or execution queue.

Gravit's native `subagent` tool starts a fresh context and defaults to a continuable background
child. It returns an id as soon as the first prompt is admitted. `send_message` queues a later
turn in that same child, `list_agents` inspects existing children, and `interrupt_agent` stops
the target's current turn. dsh 0.2.0 deleted the `report` tool: a resident continuable child
now messages its direct parent with the same `send_message`, which lands in the parent as an
`agent-message` relay naming the child; the runtime separately sends a settlement notice
(`subagent-settled`) with the outcome and any final answer. Relays run both ways — a parent's
`send_message` reaches its child the same way.
Gravit can continue independent work or end its turn to await that notice. A foreground
`subagent` call (`run_in_background: false`) waits and returns a one-shot result;
`subagent_fork` also remains one-shot and copies a prefix of its parent's history.

On the old chat page the session's **临时子任务** panel listed its direct children, including
one-shot history and catalog diagnostics. **委派子任务** prepares a prompt for the operator to complete and send to
Gravit. **查看最近输出** reads a labelled snapshot; reopening it reads the latest log again.
Opening a child follows its durable subagent address, which dsh never activates. The child page
uses its task label, links back to its direct parent, and routes continuations and
interruption through the native parent/child address. Nested work is reached through each
child's own panel. A child's message and the runtime's settlement notice are distinct
transcript items, with their original text and source retained on replay; in a child's own
transcript a message from its parent reads **父会话消息**, with a **返回父会话** button,
never as a child report.

dsh 0.2.0 has no subagent catalog or history Remote any more; the face composes both from
the session Remotes:

| Remote | What the face uses it for |
|---|---|
| `session/projections` on the parent | The direct-child catalog (`values.subagentCatalog`: durable mode and label — on the gravit-ui client it arrives on the control stream and the list's projection blocks), joined in the client with the `session/list` rows for the parent's availability (`agentAvailable`) and each child's activity (`running`); no activation |
| `session/follow` / `session/page` on a subagent address `{kind: "subagent", parentSessionId, childSessionId, mode}` | A child's transcript (followed), and **查看最近输出** (the child's own `session/projections` cut, then one `session/page` of 12 messages); neither activates anything |
| `subagents/prompt` | Human follow-up to a continuable child, through its exact live parent (`requestId`, `delivery: "queue"`); acceptance returns a message id |
| `subagents/interruptByParent` | Request interruption of a continuable child's current turn — Children's **Stop**, which says `Stopping <label>`; acceptance does not mean it has stopped yet |

Refusals arrive as the host's own codes — `subagent/unauthorized`,
`subagent/parent-unavailable`, `subagent/not-found`, `subagent/catalog-diagnostic`.

**State and limits.** **Running** (the old page's **运行中**) means the child is mid-turn (its
list row's `running`) and **Not running** (`inactive`, **未运行**) that it is not — which proves
neither success, completion nor failure. At 0.1.1 running meant resident in the host, so an idle
resident child now reads Not running and offers no interrupt. A child the list does not show
reads **Unknown** (**运行状态未知**). A child the 0.2.0 migration could not classify (catalog
mode `unknown`) shows as the `unsupported` diagnostic, **Unavailable**: visible, never
controllable. One-shot children are read-only history and have no Stop. A cold parent
cannot authorize a continuation: send a message in the parent conversation first, then retry.
Merely viewing the parent's history does not reactivate it. Interruption preserves unclaimed
queued messages and published descendants; it neither deletes the child nor stops its whole
tree. A later send can resume parked work. The native runtime owns permission inheritance,
ownership checks and cold resume. The face grants no additional tools or filesystem access.

The deployment persona in the repository's `dsh/profile/persona.md` explains when to consult
room voices and when to delegate a bounded task, how to wait for results, and how to report
uncertainty. Named bots retain their existing delegation mask.

## The wire and the transcript (client/js/wire/api.js + mapper.js + client/js/host/live.js)

dsh 0.2.0 deleted the wire the 0.1.1 face spoke — `POST /api/<dotted.method>`,
`POST /api/respond`, the downlink-only `/api/events.mux` — and every byte of it now 404s.
The page speaks Typert Remote through `client/js/wire/api.js`, and nothing else:

- `call(endpoint, args)` — `POST /api/<namespace>/<method>`, body
  `{type: "client-request", rpcId, method, payload: {args}}`. A business failure rejects
  with the host's `code` (`session/not-found`, `gateway/arguments-invalid`,
  `agent-preset/locked`, …), a carrier failure with the HTTP `status` (401: not signed in).
  A dotted 0.1.1 name is refused before any request leaves the page.
- `openMux(…)` — ONE WebSocket, `/api/remote.mux`, carrying every stream:
  - `$events`, internal to `api.js`, one per socket generation: `ready` first, with the
    `clientId` every answer is bound to; then host facts (`api-session/added|removed|status|activity|error`,
    `agent-preset/selected`), gates (`waterfall` items for `approval/request` and
    `user-questions/request`) and their withdrawal (`cancel`);
  - `session/control`: a baseline of every attached session's projections, then one
    `projection` item per change — titles, token usage, the room strip, the subagent catalog;
  - `session/follow`: one session's transcript — a snapshot, then gap-free events, plus
    assistant-stream frames (the pulses) when asked for.
- `answer(eventId, value)` — the only way to answer a gate: `POST /api/$events/result`
  under the CURRENT generation's `clientId`.

**Reconnects** wait a fixed 1.5 s. There is no resume cursor: each new socket re-opens every
registered stream under fresh ids, and the status line reads `Reconnecting… (<reason>)`
until the new generation's `ready` clears it. A socket close, a frame outside the
protocol, and an `$events` end or error all lose the generation the same way. Pending gates
are re-delivered after `ready` under their original `eventId`; one that is not re-delivered
shortly after (1 s in `api.js`; the page keeps no backstop of its own) was settled while the page was
away, and its card closes. A follow re-opened after a drop REPLACES the drawn window rather
than appending a second copy.

**Gates are keyed by the `$events` `eventId`**, not by an audit id — none rides the wire any
more; the message carries `eventId` and `callId` in its `data`. Every connected tab receives the
same gate; the first answer settles it and every other tab receives `cancel`. Gates bypass
the transcript queue, so a card is never hidden behind a session read that failed. The card
says how it ended:

| The card reads | Meaning |
|---|---|
| `Approved`, `Declined`, `Answered` | this tab's answer settled it (a question's outcome is simply `Answered`) |
| `Settled elsewhere` | this tab's answer resolved, but the host's `cancel` trailed it: another answer or a Stop settled the gate first and this answer was NOT applied — the host answers a late answer with the same silent `ok`, and `api.js` reports the trailing `cancel` |
| `Closed` | the gate is over without this tab's answer: another tab answered, the turn was stopped, the session went away, or it was settled while the page was disconnected — a `cancel`, or a gate not replayed after `ready`; neither carries an outcome, so the card claims none |
| the status line, `answer: not-pending` / `answer: gate-gone` / `answer: not-ready` | this answer was refused by `api.js` — this connection does not hold the gate, the host withdrew it while the answer was in flight (a lost race caught in flight; the card reads `Closed` when the withdrawal lands), or no `ready` has bound a clientId yet. A second press while an answer is in flight sends nothing |

An approval card sends only `allowed-once` or `rejected`. At 0.2.0 that is the face client's
rule — `api.js` refuses anything else as `bad-value` — no longer the host's, which would
accept any value in its vocabulary.

**Opening a session: follow or page (upgrade decision D16).** Following a COLD session
activates it: dsh resumes its agent, and a resume write-opens the log — publishing
`session.v4.jsonl.zstd` and taking `session.lock` before anything is appended,
irreversibly. 0.1.1's history read was read-only, so the page keeps it that way
(`viewFor` and the view record in `client/js/host/live.js`):

- a LIVE session (its list row says `agentAvailable`) is FOLLOWED, with pulses (subagent
  children are not listed; a parent's Details names them under Children, from its catalog,
  without reading them);
- a COLD session is PAGED: `session/projections` fixes the cut and `session/page`
  reads the tail window through it (the host's default window), and neither call
  activates anything;
- a paged session becomes a follow once it is live — this tab prompts it, sends it a
  command or an `@`, or the host reports it came alive. A list refresh never downgrades a
  live follow; a socket drop suspends every follow a re-open could turn into an activation,
  and the reconnect re-decides each one from the fresh list.

What still activates a cold session is WRITING to it: a prompt, a slash command, a rename,
an `@` into a room, a `dispatch` to a room member. Under 0.2.0 the first such write to a
session 0.1.1 wrote publishes `session.v4.jsonl.zstd` beside its byte-preserved
`session.jsonl.zstd`, never rolled back. A view does not write-open the log — which also
keeps delete clean (Channels, above). Stop on a paged session answers `session/not-found …
(not attached)`: there is no turn to stop.

**A new conversation** is created, named when a title was typed, and prompted; the list then
reports it live, so its open is a follow and the reply streams without a click on its row. **Slash lines** go to `commands/execute` first — 0.2.0's prompt
would hand them to the model as text — and only a line no command claims continues as a
prompt; the command's result is its only feedback, on the status line (red for an error).
Every prompt carries a client-minted `requestId`.

**Face routes that fill what 0.2.0 dropped.** `GET /data/host.json` →
`{ok, cwd, home, attachedSessions, version}`, 0.1.1 `host.describe`'s host facts (read by
Discover's Gravit item);
`/data/channels.json` gains `presets`, sessionId → the `agentPreset` its header names,
because `session/list` rows lost that field (`client/js/wire/summaries.js` reads it). Both are
fence-only like every `/data` read.

**Against a 0.1.1 host** the page renders nothing — the mapper maps every 0.1.1 frame to
`ignore` and `call` refuses dotted names — rather than something half-right.

## Chat rendering (client/js/render/thread.js)

The thread draws the kind table (`client/js/host/kinds.js`, `DEVELOPMENT.md` §5.3): the
operator's words right, Gravit's left through DOM-built markdown, a bot's words in a group under
its name, a context row — a compaction checkpoint, a plugin notice, the runtime snapshot — as a
collapsed `context · <source>` details — and no tool row: since 2026-10-28 (the operator's
word) a call is not drawn, in the thread or a Trace, its gate, receipt or refusal being rows of their own
("Tool results" below) —, the seat's card, the approval card, the question card, a receipt and a
refusal; an answered or closed gate shows its end state as a chip and no keys. A disclosure you
opened (a Trace) stays open across the page's renders. The old chat page's
closed **思考轨迹** disclosure (`client/answer-traces.js`, deleted) folded context, thinking and
tool calls under every answer; on the gravit-ui client the thread draws no
tool call, a room member's answer has its **Trace** ("Rooms" above), and there is no `think` row
(the reasoning text the mapper carries is not drawn).

An ok `lunhui_present` call is the one tool call that draws, as Gravit's **composed answer**
(since 2026-10-30, plan 2 of the run view; `client/js/render/lunhui/`, `DEVELOPMENT.md` §5.4):
the summary as Gravit wrote it, then the blocks in its order, every number drawn by the face from
the run's view (`GET /data/lunhui/view`, read once per answer by `client/js/host/lunhui.js`),
the footer, and all times in China time. The words Gravit wrote on the way fold into one closed
**Working notes · N** just above it; a view that cannot be read leaves the summary, one error
line and **Retry**. A refused call draws nothing.

Thinking follows dsh's design: while the host streams a turn the thread's tail carries one
ephemeral three-dot row — NEVER content — set by the assistant-stream pulses of the followed
session, and gone when the message settles. The pulses come only from a follow opened with
the assistant stream — the session on screen — and the stream's deltas themselves are never
drawn. The live members of a room on screen are not followed, so their pulses do not show.

Gravit's bubbles, a room member's and a channel's thesis render markdown
(`client/js/wire/markdown.js`, DOM-built, serialized for the string renderer): headings, bold,
inline code, links, lists, fenced code, quotes, and GFM tables; the operator's own messages
render exactly as typed.

### Tool results

No tool call is drawn since 2026-10-28 (the operator's word): not in the thread, not in a member's
Trace — one in a conversation written before then included; the gate a call raises, the seat's
receipt or refusal are rows of their own. `client/js/render/tool-result.js` left with the `.tool`
rules: it was the seam that dressed a result by its server's name, and dressed none since the
Alpaca server's renderers left on 2026-10-24. What holds is the
host's side: dsh spills a tool result over its inline budget into head + tail with an
elision seam and a note naming the full-output file. At 0.2.0 that budget is dsh-base's
`spill-policy` `maxInlineTokens: 12500`, estimated as characters ÷ 4 — about 50 000
characters of ASCII, where 0.1.1 counted 50 000 bytes — so CJK-heavy AKShare results now stay
inline about three times longer in bytes. The face keeps dsh-base's default (upgrade decision
D18); a `spill-policy` row in the profile patch changes it.

## Tests

```bash
npm test                  # offline unit tests - no keys, no network, no port
npm run typecheck         # strict tsc against the pinned .d.ts (skipLibCheck: false) - the contract test
FACE_SMOKE=1 npm test     # + the 29 isolated real boots; local stubs, no external model calls
```

Offline, `npm test` skips the 29 real boots listed below; `FACE_SMOKE=1` runs
them too. The typecheck includes the dependencies' own `.d.ts`, so a green one
means the face compiles against the installed dsh, not just against itself.

`npm test` works on seams: the composed patch stack, a recorder standing in for
the webserver, a recorded event stream (`tests/fixtures/events.jsonl`, in
0.2.0's v4 wire shapes), the version pins. The real boots are the only place a
composition that typechecks but does not MOUNT gets caught. Each boots the real
plugin tree into its own `mkdtemp` harness home — never `~/.dsh` — and each
lives in a file of its own, because `bootFace` sets `DSH_HOME` for the process
and `node --test` gives each file its own:

| File | What it proves on a real tree |
|---|---|
| `smoke.test.ts` | the sign-in (`/` 401, token 303 + cookie, page 200); `session/list` over the new wire; `/api` 401 without the cookie and 403 on a forged `Host` even with one (the fence runs before auth); the mux upgrade has NO route until `commitReady()`, then answers 401 without the cookie and 101 with it; the Gate-2 answer channel end to end — two signed-in `$events` tabs get the same approval, one answers, the other gets `cancel`, the grant lands in the session log; `ask_user_question`, `str_replace_editor` and `ralph` registered, `web_fetch` and the MCP resource tools not; zero inactive rows; `/client/*` and `/data` served without the cookie, the `/data` fence drilled on its own (the search route), `/market` and `/account` answering 404, and the four removed producer and bars addresses answering 404 |
| `order-gate.test.ts` (its real-tree case) | Gate 2's listener is registered: it asks for the seat-write stand-in `mcp__drill__portfolio_live_order` (the card `Account seat - …` naming `AAPL`, `side=buy` and the venue), `mcp__drill__portfolio_live_cancel` and a renamed server's `portfolio_pay`, refuses an agentless call, lets a seat read and `mcp__drill__orders` through; the guard refuses the stand-in whose ask an outer listener swallowed, and a session whose log it cannot read with its own sentence |
| `order-gate-smoke.test.ts` | Gate 2's POSITIVE path: an approved stand-in order dispatches, a rejected one does not; then the same through the real `$events` channel |
| `order-gate-midboot-smoke.test.ts` | Gate 2 armed while `boot()` is still pending: a slow fixture row holds the boot open while a seat-write stand-in registers, and with `bootFace` unresolved and unary `/api` already serving, the order call is HELD with `approval/asked` logged and its body not run, an agentless call is denied by the listener, the same order with its ask swallowed by an outer listener is denied by the guard alone; once the boot is released the held card reaches the first tab and `allowed-once` dispatches exactly once; a restart of the real `approval` row re-arms the listener once |
| `account-seat-smoke.test.ts` | the Account seat against the Account's own stand-in (run from the repo's `account/`, or `FACE_ACCOUNT_SEAT_DIR` when set; skipped without its `npm ci`): the seat's 36 tools and exactly its nine real-account writes gated, a read as the admitted seat, a seat order rejected at the face's card never reaching the seat, the same order allowed once answered by the stand-in with a card, a batch answered leg by leg with cards, and `/data/seat.json` reading that standing with the Account's ISO expiry as milliseconds |
| `account-graft-smoke.test.ts` | the Account's reads through the face's proxy against the Account's own stand-in (run from the repo's `account/`, or `FACE_ACCOUNT_SEAT_DIR` when set; skipped without its `npm ci`; "The Account in the face"): `/data/account` 200 with `ok` and its venues, `/data/account/explore` listing items, `explore?force=1` refused 400 without asking the Account, `/data/account/stream` an event stream whose first named frame carries JSON within 5 s, and `/data/seat.json` reading the Account reachable through the proxy's reader; then the owner's half through the face's port — the client's own `host/owner.js` under Node paired with the stand-in's code, a watch signed on and off, a $25 ETH market buy whose `fill` the stream tells and whose ETH the holdings count, a SOL limit resting and cancelled by its id, the seeded card approved and its `card` frame `approved`, a foreign origin's exchange refused 403, and neither the code nor any signature sent in the face's output |
| `gravit-client-smoke.test.ts` | the new page on a real boot: `/` with its title and script, the modules under `/client` with their types (Markets' `js/wire/china.js` and `js/host/markets.js` among them), the old `chat.js` gone and `/market` and `/account` answering 404; the host layer (`client/js/host/live.js` over the page's own wire) listing a session just created and opening it (live, so a follow) into a loaded window with a clean status line; a bare `bootFace` mounts no `/data` route, which the list tolerates |
| `client-mux-smoke.test.ts` | the page's own `client/js/wire/api.js` and `client/js/wire/mapper.js`, unmodified, against the host: ready, calls, emits, the control baseline, a follow's snapshot and tail, an approval answered and one rejected, a second tab's `cancel` and its refused late answer, Stop withdrawing a gate, a question answered, a gate replayed to a late tab, the non-activating page and projections reads |
| `askuser-noclient-smoke.test.ts` | with no browser connected, an agent's question BLOCKS (parked for the next client); an agentless one is refused `NO_PROVIDER` |
| `bots-smoke.test.ts` | the roster (a broken fixture listed with its reason, never `_template`); the shipped relative plugin path rebased onto the real `plugins/bot.js`; a bot sees allow ∩ tree, never a `role_<id>` tool, while Gravit sees the host's whole roster plus `role_cn_market_analyst` and `role_cn_stock_analyst`; a tool registered after the declaration is admitted; the bot's persona shadows Gravit's; Gravit's prompt carries the `deployment:today` line, the cycle contract (`Step 0 — ask once`) and the `lunhui:run` protocol and a bot's carries none of them — the probe bot can call `create_goal`, so its missing contract is the preset's scoping, not the `create_goal` gate; a session naming a broken preset is refused with dsh's `agent-preset/*` code; Gate 2 holds for a bot |
| `bot-runtime-smoke.test.ts` | a saved route reaches the real request without changing the host default; a save re-declares — the old conversation keeps the old soul, a new one gets the new; the journal as a runtime-context snapshot; `agentPresets/select` |
| `bot-sandbox-smoke.test.ts` | a `read-only` session's write is refused inside the tool's content (`[sandbox: file access denied under read-only mode]`), never silently |
| `room-smoke.test.ts` | a round on a stub model: dispatch to three bots, answers on the room log before the one wake, the synthesis; every member parented, preset-joined, `read-only` from its first event, without `dispatch`; the `room` value in the list row and in the per-record cache file; the operator's `@` and its refused write; a home session's journal write |
| `room-discussion-smoke.test.ts` | a structured serial round: peer context, declared disagreements, the malformed-answer fallback, each member's own journal, Gravit's synthesis request, metadata surviving a flush and a re-read |
| `subagents-smoke.test.ts` | the native subagent tools and Remotes: creation, child messages kept apart from settlement notices, permission inheritance, parent ownership, ordinary writes to managed children refused, and — after a reboot — catalog and history reads that activate neither side |
| `instructions-smoke.test.ts` | what the `agent-instructions` baseline carries on a first request after the face's instructions patch: `GRAVIT.md` and `GRAVIT.local.md` for Gravit at the repo root; the root file plus the channel's own `strategies/x/GRAVIT.md` for a channel session; the root file for a bot session; `AGENTS.md` for none of them, `CLAUDE.md` for neither Gravit nor the channel session |
| `roles-smoke.test.ts` | a role is a one-shot child with its own persona and tools, over two fixture roles made from `roles/_template` under the test's own roles root: `role_auditor` and `role_worker` each spawn a child whose tool list EQUALS the role's `allow` (every `role_*` tool and the forbidden ones gone — compared exactly, because dsh exempts a scope's own registrations from `restrict()`); for the auditor's child the smoke also checks the system prompt — the role's persona (shadowing Gravit's), the date line, no `gravit:roles` section and no cycle contract — the header (`origin: subagent`, `agentPreset: gravit`, its parent's cwd), the root `GRAVIT.md` in its `agent-instructions` baseline, and its text returning through the tool, while Gravit's own prompt carries the roles section and the cycle contract (`Step 0 — ask once`); a `subagent_fork` child's first request carries Gravit's system text whole — the cycle contract included — and Gravit's tools in order; a plain `subagent` child (unseeded) can call `create_goal` and every role tool yet carries neither the cycle contract nor the roles section, only the date; a role naming a tool the tree lacks fails at delegation with `tools.restrict() names unknown global tool "…"` and creates no child. The MCP tools the roles name are `mcp__fixture__*` stand-ins; a foreground one-shot child leaves `ctx.sessions` as its result returns, so the smoke copies each session's header while serving its request. A second boot takes the shipped `cn-market-analyst` from a fixture copy of `roles/` with its route turned to the stub, over a temp strategies root: its tools EQUAL its allow list, its persona is its own, its read and `NOT_EVALUABLE` submit land in an empty `cn-market` run; the same submit from Gravit's root is `NOT_A_ROLE`; a freeze is out of the role child's reach, and a plain `subagent` child that can reach one is `NOT_GRAVIT`; a third boot takes `cn-stock-analyst` the same way: its tools EQUAL its allow list, its persona is its own, its leader read citing a sealed `cn-market` run (sentiment and theme artifacts landed through the booted service) and its submit landing `leader.json` with that `market_run`; Gravit's root leader submit is `NOT_A_ROLE`; a fourth boot takes `cn-reviewer` the same way: its tools EQUAL its allow list, its persona is its own, its read of a sealed `cn-market` run with no `market_run` shows the run's three artifacts and its submit lands `counterevidence.json`; Gravit's root submit is `NOT_A_ROLE` |
| `lunhui-market-run-smoke.test.ts` | one whole `cn-market` run ("Lunhui analysis"): the seat off, the stub as the model, the freeze rows on the recorded replies, a temp strategies root holding a copy of `cn-market`; Gravit freezes index, limit-up and boards into one run, calls `role_cn_market_analyst`, then `role_cn_reviewer` with no `market_run`, and reads the run back, the analyst's child reads the three contexts and submits three `OK` artifacts built from them and the reviewer's child one item against the sentiment; the run sealed with three evidence files, the four artifacts named in `run.json` and valid again against the sealed files, the budget kept, four chips on the runs card, the protocol in Gravit's prompt. The freezes read the system clock (a row's `now` cannot cross the boot's structured clone of patches), so the file shifts `Date` to Friday 2026-10-23 15:00 China time for the boot's lifetime |
| `lunhui-strategy-run-smoke.test.ts` | an `S01` registered on Friday and graded on Monday ("Lunhui analysis"): the market smoke's boot with copies of `cn-market` and `lunhui-s01-repair` and the three roles on the stub; each day Gravit does the reviewed market run, finds it with the listing read, freezes two stocks' quotes on the strategy and calls `role_cn_stock_analyst` for the leader, `role_cn_reviewer` with both run ids and `role_cn_stock_analyst` for the mode, each child building its artifact from its context; Friday's mode `S01` with a card of at most 2,048 bytes, every review item answered, Monday's grading it; every artifact of the four runs valid again against digests rebuilt from the sealed runs, the runs card's latest run Monday's with its review line, the protocol's strategy channel in Gravit's prompt. `Date` is replaced, Friday 2026-10-23 15:00 China time, then Monday 2026-10-26 15:00 |
| `lunhui-answer-smoke.test.ts` | Gravit's composed answer end to end: the seat off, `lunhui-runs` over a scratch strategies root holding the synthetic sealed 10-27 run; the view read over `GET /data/lunhui/view` (registered as `main.ts` does) with the signed-in cookie; an ok `lunhui_present` lifted through `host/kinds.js` and drawn by the client's own `renderThread` — the seven kinds' labels in the call's order, the follow-ups, the footer with `Open run ›`, a stock link — and `stockDrawerHtml` for 上海九百 drawing its minute chart with the limit-up line; no model called |
| `goal-smoke.test.ts` | the goal loop `../dsh/profile/cycle.md` rests on, through the face's own wire (prompts, the Stop button's `session/cancel`, a slash line's `commands/execute`): `create_goal` in a human turn returns the id and revision 1, armed; each round arrives at idle as a user message whose source is `goal` (`<goal_round>`, the objective, `Round: n/N`); the model's `blocked` in round 1 is refused (`blocked requires at least 3 consecutive goal rounds; current round is 1`), in round 3 accepted with the code `model-reported` and followed by the `<goal_blocked>` wrap-up; a second `create_goal` is refused while that goal is blocked (`GOAL_ALREADY_EXISTS`); at the cap the driver blocks with `round-limit` and sends the model nothing more; Stop mid-round pauses the goal, the model's resume of it is refused (`GOAL_TOOL_RESUME_PAUSED`: `the model cannot resume a paused goal; the user must resume it`) and `/goal resume` re-arms it; a face stopped mid-round and booted again on the same home leaves the goal active and disarmed with no request until "continue", whose `update_goal` resume bumps the revision and re-arms the rounds |
| `desk-smoke.test.ts` | the desk on a real tree, as `main.ts` installs it, its fixture root inside the repository so the repository's `GRAVIT.md` heads the chain: the `gravit-desk` session runs in `desk/journal/` under `workspace-write`; its tools are exactly `DESK_ALLOW` expanded on this tree plus `desk_quotes` and `desk_state`, each `mcp__*__<raw>` entry matching one server's tool, and neither desk tool reaches Gravit's session or the global view; the write tools take the path arguments the guard's write check reads, and `str_replace_editor`'s commands are `view`, `create`, `str_replace` and `insert`; the desk's prompt carries Gravit's persona prefix, the date and `# The desk`, and no cycle contract or roles section; a desk turn naming the order stand-in gets Gate 2's visibility refusal and its body never runs; a `write` to `../levels.yml` is refused by the sandbox inside the tool's content while a journal write lands, with no card; Gravit's own write of a `GRAVIT.md` lands; with a listener in front answering allow, the guard's backstop still denies the desk's write of `GRAVIT.md` and its read of a `.env` file, while Gravit's own read of that file goes through unjudged; `/stop` on a turn parked on an escalation card, two texts queued behind it, cuts that turn alone — recorded `cancelled`, `stopped from the phone` — and both texts are answered, in order; the desk's write of a journal `.gitignore` holding `!*` and of a `CLAUDE.md` are denied with no file written, and its read of a dot-config in the repository is denied by name while Gravit reads it; the read tools take exactly the parameters the read check reads; a `GRAVIT.md` planted in the journal reaches a desk session's first request behind the repository's, which is the threat the fence refuses, and the next post is refused with `desk-refused` and no turn; each supervised turn is one `desk-turn` with four token buckets and the stub's route |
| `telegram-smoke.test.ts` | the bridge end to end on a real tree against a `node:http` Bot API stub on 127.0.0.1: the token and the operator's id come from the scratch home's `.env`, and the MCP child dsh spawns has the id and not the token; a stranger and a group are dropped and counted, unanswered, and the operator's `hi` is answered in the operator's chat; `/status` counts the drops and names the desk session; `/pause` writes `OFF` by `telegram`, a text then gets the paused line and opens no turn, and `/resume` is text that never reaches the model; a 503 queues the reply in the outbox and the next poll flushes it, in order, each reply sent once; a 409 is recorded and waited out; a card parked by an escalated write to `../levels.yml` is cut at the desk's deadline (1,500 ms here) with the timed-out line; the canary — the desk's write of `GRAVIT.md` is denied by the desk guard and no request carries a planted text, then a `GRAVIT.md` the harness plants is refused by the fence with no turn; its read case — `send me ~/.dsh/.env`: the read of the scratch home's `.env` is refused as outside the repository, the token handed to a market read is refused as a secret, no tool result carries the token or a second secret, and the stub's reply, which names both, reaches the phone as `I could not read it: <secret> <token>`; across the file every send went to the operator's chat, the token is in no file of the desk's directory, and no `STANDING.md`, `levels.yml`, `rules.yml` or `holdings.yml` changed |
| `schedule-smoke.test.ts` | the standing orders' clock end to end, as `main.ts` installs the desk, on one early-close session (2026-11-27), a fake clock and calendar, a stub model and a recorder for the phone, its fixture root, harness home and bots root under `tests/tmp/`: a firing a restart cut off is reported `interrupted` at boot and never run; the pre-close brief wakes one fresh `gravit-desk` session in `desk/journal` under `workspace-write`, with the armed text — hashing to its pin — and the producer's block in its wake message, and its final text reaches the phone; `firings.jsonl` holds `started`, `producer`, `woke` and `finished`, `events.jsonl` one `desk-turn` with `source: "schedule"` and four token buckets; a script producer's stderr reaches only the face's log; a turn waiting in a long tool is cut at its 10-minute deadline and the order queued behind it fires after; an edited text is refused with one line, then in silence, and fires once re-armed inside its grace; the pause refuses in silence and a spent budget with one line; an anchor slept across is `missed`; a `wake: false` order runs only its producer; a planted `GRAVIT.md` refuses the firing; the canary's firing half — a poisoned turn's writes of `../STANDING.md`, of `standing.yml` and of a journal `GRAVIT.md` are all refused, no card raised, every text and `standing.yml` unchanged — and a `GRAVIT.md` the harness plants refuses the next order; the clock's dispose cuts a firing in a long tool and settles; every text the desk sent went through the recorder |

`bot-sandbox-smoke.test.ts` and `askuser-noclient-smoke.test.ts` also print one
`observed:` line each (S4, S7), the measurements the bots spec's amendments were
worded from.

## Upgrading dsh — three pins, not one

`src/version.ts` holds them, and they move independently:

- **`DSH_PIN` = `0.2.0-rc.2`** — the entire `@deepseek-ai/dsh-*` family, pinned
  EXACT. Lockstep only: these packages are tested only against each other at one
  version, and a mixed set breaks the Remote wire and the session format between
  them. `tests/version.test.ts` sweeps every `@deepseek-ai/dsh-*` entry across
  `dependencies` and `devDependencies` PROGRAMMATICALLY and asserts declared
  range == installed version == `DSH_PIN`, so a dependency added later is
  covered without anyone remembering to extend a list. It also refuses the
  three packages 0.2.0 retired (`dsh-agent-presets`, `dsh-host-apiproxy`,
  `dsh-cordis-host-runner`), so a partial revert cannot pass the sweep on a
  mixed tree.
- **`CORDIS_PIN` = `4.0.4`** — `@deepseek-ai/cordis` rides its own 4.x track.
  Every dsh package, and the CLI, peer-depends on it with a TILDE range
  (`~4.0.4`), so a 4.1 would not satisfy them. Bumped separately and
  deliberately.
- **`CORDIS_INCLUDE_PIN` = `1.0.9`** — `@deepseek-ai/cordis-plugin-include`,
  the one cordis plugin the face imports itself (`entryListSchema`, to read bot
  compositions in the Loader's own dialect).

Not pinned by the face: `cordis-plugin-loader` and `cordis-plugin-group` arrive
as `dsh-app-boot` peers (`~1.0.5`, `~1.0.4`), and `cordis-plugin-timer` through
`dsh-base` (`~1.1.6`); the 0.1.1 `cordis-plugin-hmr` is gone. Only
`package-lock.json` holds them still. Keep the lockfile committed, and read a
lockfile-only change to those three as a real upgrade that deserves the drill
below.

**The drill.** Bump `package.json` AND the matching constant in `src/version.ts`
together — every pin whose track moved — then:

1. `npm install` — first, and not optional: the pin sweep reads the INSTALLED
   tree as well as the manifest, so running it against a stale `node_modules`
   fails on the old versions rather than on anything about the upgrade.
2. `npm test` — the pin sweep fails first when the manifest, the installed tree,
   and a constant disagree. A green sweep is the precondition for the rest,
   not evidence the upgrade is good.
3. `npm run typecheck` — the contract test. `skipLibCheck` is `false`, so the
   dependencies' own `.d.ts` are checked too (clean under TypeScript 5.9 at
   0.2.0-rc.2). A renamed config key, a narrowed value, a changed exported
   signature: they surface here, because the overlay's row configs are
   `satisfies`-checked against the plugins' OWN exported config types rather
   than against a local `Record<string, unknown>`.
4. **Re-diff `src/boot.ts` against the CLI's current `profile-boot-*.js`
   chunk.** At 0.2.0-rc.2 that is `@deepseek-ai/dsh`
   `lib/profile-boot-BZ2ZjNWi.js` — functions `prepareProfile`,
   `composeProfile`, `runProfile` (upstream `apps/cli/src/profile-boot.ts`).
   The chunk name is content-hashed and changes on every release; the CLI is
   not a dependency of this package, so fetch it
   (`npm pack @deepseek-ai/dsh@<new>`) to read it. The CLI now also publishes
   the same functions as `@deepseek-ai/dsh/profile-boot` — a reading aid, not
   something to import: `runProfile` would bring `profileContext`, the CLI's
   own signal handlers and an `appReady` committed before Gate 2 exists. This
   is the one private piece the face mirrors, and a composition that has
   drifted boots a DIFFERENT tree while still compiling clean. `boot.ts`'s
   header lists the ten divergences that are deliberate — no `--patch` files,
   no `profileContext`, no proxy install, no signals, shutdown or fail-loud
   inside `bootFace`, `appReady` committed last, the face's own install anchor,
   a skipped bundle as a hard failure, the strict row audit, the policy
   layer, and Gate 2 armed inside `prepare` (before any row mounts, because
   dsh's unary `/api` is live during `boot()` and is not readiness-gated) —
   and anything else is drift. Runtime module resolution
   (`createRuntimeResolution` plus the `PluginPackages` service, installed
   inside `prepare`) replaced 0.1.1's `$DSH_HOME/profiles/node_modules` link
   farm; without it no dsh-base row resolves at all.
5. **Re-check the frame shapes.** `client/js/wire/api.js`, `client/js/wire/mapper.js` and
   `tests/fixtures/events.jsonl` against the installed `.d.ts`:
   `@deepseek-ai/dsh-api-gateway/lib/types/stream-protocol.d.ts` (the mux
   frames, the `$events` items, `$events/result`),
   `@deepseek-ai/dsh-api-remotes/lib/types/remote-events.d.ts` (what `$events`
   forwards), `@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts`
   (follow, control and page frames, `SessionSummary`),
   `@deepseek-ai/dsh-session/lib/types/types.d.ts` (session events,
   `SurfaceOp`), `@deepseek-ai/dsh-llm/lib/types/message.d.ts` and `types.d.ts`,
   and the two answerable gate requests in
   `@deepseek-ai/dsh-user-approval/lib/types/types.d.ts` and
   `@deepseek-ai/dsh-user-questions/lib/types/types.d.ts`. The client is untyped
   JavaScript talking to a typed wire, so `tsc` does not cover this hop — the
   fixture is the contract, and a fixture that no longer matches the wire makes
   the mapper tests green against a stream nobody sends.
6. `npm run check:fixture` (`scripts/validate-fixture.mjs`) — runs the fixture
   through the INSTALLED dsh's own acceptance code: the session controller's
   `assertSessionWireEvent`, which the upstream client applies to every follow
   and page record, and the gateway's frame parser and `$events` id
   predicates. A frame kind with no upstream validator (assistant-stream,
   projection) is counted and named, never passed silently; 0.1.1 shapes are
   rejected. At 0.2.0-rc.2: 26 lines, 23 validated, 0 rejected.
7. `FACE_SMOKE=1 npm test` — the only step that proves the new tree MOUNTS,
   that the page's own transport works against it (`client-mux-smoke`), that
   the goal loop `../dsh/profile/cycle.md` describes still behaves as written
   (`goal-smoke`), and that an APPROVED order still dispatches
   (`order-gate-smoke`). That last test
   exists because 0.2.0 removed `Session.events`: the Gate-2 guard read
   `undefined` and denied every approved order, failing closed with nothing
   looking wrong. `snapshotEvents()`, which the guard and the room engine read
   now, is deprecated upstream for new callers — a later pin that drops it
   fails them closed, loudly, and this step says so.
8. Run the drills below — Gate 2, ask-user, transport, bots, room, and roles
   once one ships — on a face booted against a SCRATCH `DSH_HOME` first (the role
   drill on a COPY of the home with the operator's MCP rows, as it says).

Only then trust it — and only then point it at the real harness home, where the
cycle drill runs last: it needs the real keys and the real Account with a paper
venue, and it writes a strategy directory and places paper orders.

### The harness home across the upgrade

0.2.0 writes things into `$DSH_HOME` that 0.1.1 never did, and none of them is
rolled back. The go-live procedure — the backup, a read-only dry run of every
session on a COPY of the home, the D2 row, the first live boot, the exact
restore — is `../docs/superpowers/runbooks/2026-09-30-dsh-0.2.0-rc.2-go-live.md`.
Its dry run is `scripts/check-home.ts`: it refuses the live home, and any
directory without the runbook's `DRY-RUN-COPY` marker, before it loads
anything; boots the face on the copy with every MCP row disabled in memory
(`bootFace`'s `extraPatches`, never by writing the copy's files); read-opens
every session; and writes `<copy>.check-home.json` beside the copy. The facts
the runbook stands on:

- **The first boot on a home writes** the `client-connection/browser-session`
  grant into `.credentials.yaml`, and per-record projection-cache files under
  `storages/session_projcache/sessions/` (0.1.1's single `session_projcache.json`
  is left in place). `settings.yaml` stays untouched (D1).
- **The first write to each pre-0.2 session** — a prompt, a command, a rename,
  an `@` or a room dispatch; never a view (D16), and not a fork, which reads its
  source cold — publishes `session.v4.jsonl.zstd` and takes `session.lock`
  beside the byte-preserved `session.jsonl.zstd`.
- **The 0.1.1 CLI and the pre-upgrade face do not run on a home 0.2.0 has
  written (D12).** 0.1.1 reads only `session.jsonl.zstd`, so any resume there
  forks history away from the v4 file; it never takes `session.lock`; and any
  workspace write it makes prunes every session it cannot see — every session
  born under 0.2.0 — from its channel in `storages/workspace.json`,
  permanently. The only safe rollback is a full restore of the backed-up home.
- **Then `$DSH_HOME/profiles/node_modules` goes (D13).** It is 0.1.1's link
  farm into its own packages: nothing writes it now, but 0.2.0's runtime
  resolution still falls through to it for a row naming a package outside the
  face's dependency closure — a mixed-version hazard. The 0.1.1 CLI re-heals
  it, which is why this waits for D12.

## Sessions written before 0.2.0

dsh 0.2.0 reads a 0.1.1 log by migrating it in memory, format v0 to v4, on
each open until a first 0.2 write publishes the v4 file, and refuses what the
migration cannot classify. Measured on
2026-09-30 against a COPY of the operator's harness home: 14 of its 39 sessions,
holding 64.8% of all logged events, do not open.

| Sessions | Why | dsh's refusal |
|---|---|---|
| 10 — 4 under `strategies/aqr-r1000`, 6 under `strategies/room-drill` | their logs carry `room` messages, a source the v2→v3 step does not know (upgrade decision D11) | `SessionFormatUnsupportedError`: `cannot safely transform unclassified message source` |
| 3 — every subagent child in that home, two of them under a refused AQR room | a version-2 `subagent/descriptor` (D17) | `subagent/descriptor 0 uses unsupported descriptor version 2` |
| 1 ordinary Gravit session | a corrupt log (D17) | `SessionPersistenceCorruptionError`: `… has seq gap (expected 3455, got 3427)` |

The two format refusals add `source v0 artifact remains unchanged`, and the face
keeps every one of the 14 that way — nothing here rewrites an operator log:

- Opening one fails: the read (a page for a cold session, D16; a follow for a
  subagent child) is refused, the status line shows the host's error, and
  nothing is drawn or written.
- `POST /data/rooms/say` into a legacy room answers 409 with dsh's code and
  message and the legacy hint ("Rooms", above).
- A legacy MEMBER session fails only that member's turn; the round goes on.
- Delete still works on them: the face reads the header itself.

Whether to export those transcripts while the pre-upgrade face can still render
them, leave them unreadable, or wait for an upstream migration step is the
operator's decision (D11, D17), taken in the go-live runbook.

## The Gate-2 drill (run after any face or dsh change)

A guard never pulled is presumed broken.

**What actually holds Gate 2 here.** dsh-base marks no tool `ask` per-tool.
It mounts `@deepseek-ai/dsh-user-approval` with a session-wide policy — `ask`
unless `DSH_PERMISSION_MODE=danger-full-access` — and
`@deepseek-ai/dsh-permission-presets`, whose `read-only` and `workspace-write`
presets both carry `approval: ask` while `danger-full-access` carries
`approval: never`. The default session is `workspace-write` + `ask`. What
actually RAISES a card is a **sandbox escalation**: under `workspace-write` the
sandboxed bash executor and the sandboxed fs write/edit tools are denied outside
the session workspace, the denial tells the model it may retry once, and that
one permitted retry carrying `sandbox_permissions` + `justification` resolves
`ctx.approval` before running.

**The answerer is `@deepseek-ai/dsh-api-remotes`** — the overlay's
`api-remotes` row. It forwards the `approval/request` waterfall into the Typert
gateway, which hands it to every connected tab as an `$events` item keyed by
`eventId`; the first `$events/result` settles it and every other tab receives
`cancel`. With no tab connected the ask BLOCKS — the gateway keeps it pending
and replays it to the next tab that connects — rather than denying. Without the
row at all, every ask resolves `unavailable` at once and dsh-tools denies it
`no approval channel is available`, with no card anywhere: the tree comes up
healthy and every approval fails closed with nothing on screen saying why. That
is why `bootFace` refuses a tree with no ACTIVE `dsh-api-remotes` row, and one
missing the `approval`, `userQuestions`, `typertGateway` or `permissionPresets`
service ("What boot refuses").

**Step 0, no model, no key.** `FACE_SMOKE=1 npm test`: `smoke.test.ts` drives
the answer channel over the real socket (two signed-in tabs, one answers, the
other gets `cancel`, the grant lands in the log), `client-mux-smoke.test.ts`
does the same with the page's own `client/js/wire/api.js`, and
`order-gate-smoke.test.ts` proves an approved call dispatches while a rejected
one does not. If step 0 fails, stop: the cause is the composition or the wire,
not the model.

**Step 0b, if you changed anything under `client/`.** Hard-reload the page:
`registerStatic` sets no cache headers.

**The drill**, with the face live and a session open:

1. Prompt Gravit to write a file OUTSIDE the session's workspace — the path
   Details names under Where (`Default directory` is the workbench repo root) unless you gave
   the session a project of its own — and to escalate when the sandbox denies
   it. `touch ~/face-gate2-drill` from the bash tool does it, unless that
   workspace IS your home directory, in which case pick any path outside it. Do
   NOT use `/tmp`: `workspace-write` already permits the platform temp areas, so
   a write there is allowed and asks nobody.
2. PASS, part one: the approval card renders in the face — headed by the tool's
   name, the host's reason under it (a sandbox escalation always
   sends a display text; the card adds the audit reason when the two differ),
   and exactly two keys, ✗ Decline then ✓ Approve. Two outcomes and only two: the face sends
   `allowed-once` or `rejected`. At 0.2.0 that is the client's rule, not the
   host's — the host would accept `cancelled` or `unavailable` from any
   answerer — so `client/js/wire/api.js` refuses anything else before it is sent.
3. **Decline.** The card settles to `Declined` and the command does NOT run.
   The model sees a denial result, never the card.
4. Prompt again and **Approve**. The command runs. The grant is one-shot
   (`allowed-once`) and applies to that call alone — there is no `allow-always`,
   no remembered rule, no grant store.
5. With a second tab open on the face, raise one more card: both tabs show it.
   Answer it in one; the other's card settles to `Closed`.
6. Both decisions are in the session log under `$DSH_HOME/sessions` as paired
   `approval/asked` + `approval/decided` records. Those are log-only: the audit
   is for you, not for the model.
7. Clean up: `rm ~/face-gate2-drill` (or whatever path step 1 used).

The escalation retry is capped at ONE per turn: after a denial the model may
retry that same command once, in that same turn, with a wider mode and a
justification — and that retry is what raises the card. If it answers with prose
instead of retrying, that turn is spent; prompt again, more bluntly, rather than
concluding the seam is broken.

**Never drill with a real order.** The automated drills use `mcp__drill__*`
stand-ins of the seat's writes, with nothing behind them; the one live order
drill is "The account-seat drill" below, on paper venues only.

**And a file-write drill does not stand in for one.** What it proves is the
approval CHANNEL — request → answerer → card → outcome → audit pair — which is
real and in daily use. It does not prove a PRODUCER for an MCP tool call, and
dsh ships none: at 0.2.0-rc.2 no installed `@deepseek-ai` package returns a
`tools/pre-execute` `ask` — `dsh-tools` only consumes one. What raises the card
is a *sandbox escalation*; an MCP call never takes that path. On 2026-09-04,
against the 0.1.1 tree, four independent checks said so: no `dsh-hooks*`
package under `face/node_modules`; no `{kind:'ask'}` producer in any composed
package; `dsh-permission-presets` registering only `session/created` (preset
application) and an `internal/dispatch` event *validator*, neither of which can
ask for a tool call; and `dsh-mcp-client` carrying zero references to approval,
sandbox or pre-execute.

So until 2026-09-04, for orders Gate 2 was not unproven — it was **absent**: an
order tool of the time would have run with no card and no `approval/asked`
event, with a registration flag the only thing in the way. Charter Rule 3
forbids publishing a guarantee that fails at code level, which is why this
paragraph exists rather than being quietly deleted once the hole was filled.
**The producer now exists** — "Gate 2 on the seat's writes" below — but it is a
`tools/pre-execute` listener this repo registers, not something the harness
provides, so it is exactly as durable as that registration.

Until the channel drill passes on a live face, the face does not claim even that
half.

**The approval-channel drill: PASSED 2026-08-31, re-run and PASSED 2026-09-08** on the live
0.1.1 face with the workbench toolset mounted: deny (command did not run; the model saw a
rejection result, never the card) and approve (`allowed-once`, one-shot) both exercised,
with paired `approval/asked` + `approval/decided` records in the session log. **On
0.2.0-rc.2: step 0 passes at `8f0dedb`, and the deny half was drilled live the same day**
(2026-09-30, a face at `8f0dedb` on a scratch `DSH_HOME` with the operator's MCP rows and a real
model): `touch ~/face-gate2-drill` escalated, the card rendered headed `APPROVAL bash` with the
host's `displayReason` and the audit `reason`, Deny settled it to `answered · deny`, the file was
never created, and the model reported the rejection in prose. The approve half is automated on a
real tree (`order-gate-smoke`, `smoke.test.ts` 7b) and still owed a live run — a step of the
go-live runbook. Re-run after any face or dsh change, per the heading above.

**An order tool the session cannot see raises no card.** dsh runs the
`tools/pre-execute` waterfall before it resolves whether the calling session
can see the tool, so a model that names an order tool its preset hides — the
desk's, a masked bot's — or one that is not registered at all — a seat write
with no seat mounted — still reaches the listener. The listener
looks the tool up for that session and, when it is not there, denies it
before any policy: `<name> is not available to this session - it is not
registered here, or this session's preset hides it - so no approval card is
raised and the order does not run`. A card there could only park, and an
approved one would fail `unknown tool` at dispatch. `order-gate.test.ts` pins
both causes: the stand-in from a `gravit-desk` session, and
`mcp__nowhere__portfolio_live_order` from Gravit, each refused with no
`approval/asked`, while the same stand-in from Gravit still asks.


### Gate 2 on the seat's writes

Since 2026-09-04 a per-order gate exists (`face/src/orders.ts`, armed by
`boot.ts`'s `armOrderGate` inside boot's `prepare` — since 2026-09-30, before
any row mounts, each half on its own `inject` fiber, because dsh 0.2's unary
`/api` serves turns while `boot()` is still pending and a post-boot
registration left a window; `order-gate-midboot-smoke` pins it closed). Since
2026-10-24 it gates the Account seat's writes alone — the twelve
(`SEAT_WRITE_RAW_NAMES`) under any server name, and any tool under the face's
own `mcp__account__` prefix it has not classified — the seat being Gravit's only
order path; the Python package's `place_order` / `cancel_order` left the tree
with stage 3 of the graft, and should either still register under any server,
the guard denies it outright (no card, a reason telling you to remove its MCP
row) and the boot refuses ("What boot refuses"). Two registrations, because
neither alone suffices: a `tools/pre-execute` listener returning
`{kind:'ask'}` is the only thing that can RAISE a card (a `ToolGuard` returns
`string | undefined` — deny-only), and a guard is the only thing that is
MONOTONIC, evaluated on every allow including the one `allowed-once` becomes.
The listener is registered `prepend` so it is outermost; the guard denies any
gated tool that reached dispatch without a logged `allowed-once` for that exact
`callId` and tool name in the session's own event log. Deliberately not
"without the listener seeing it": `prepend` is last-registrant-wins, so a
listener that a row registers `prepend` during boot, or anything mounted later,
sits OUTSIDE this one and could take its `ask` and return `allow` — a guard
that trusted its own sighting would wave that through (at 0.2.0-rc.2 the only
such row is `tool-jobs`, which always calls `next()`). Only the log proves a
human said yes. The card's text is the order itself — `Account seat - <tool>:
side=… usd=… symbol=… venue=…`, sent as both the audit `reason` and the display
text, so whichever a client draws, it names the order.

The guard reads the log through `snapshotEvents()`, because 0.2.0 removed the
`Session.events` getter it used to read — and that removal failed silently: the
read went `undefined`, and every APPROVED order was denied as though nobody had
approved it. A log the guard cannot read now gets its own sentence —
`<tool>: cannot read this session's log to verify an allowed-once approval (dsh
Session API changed: …)` — never the no-grant one (`<tool> reached dispatch
without a logged allowed-once approval for this call`).

**The automated half runs with `FACE_SMOKE=1 npm test`.** `order-gate.test.ts`
boots a real tree and fires `tools/pre-execute` at the stand-in
`mcp__drill__portfolio_live_order`, asserting it is claimed with a card naming
the order, that `mcp__drill__portfolio_live_cancel` asks too, that a seat read
and `mcp__drill__orders` are not claimed, that a renamed server
(`mcp__whatever_they_call_it__portfolio_pay`) is still caught, and that the
guard refuses the stand-in when an outer listener swallows its ask. Drilled
2026-09-04 against the order tools of the time, mutation-proven: removing the
registration fails it; on the seat's stand-ins since 2026-10-24.

**The positive path is automated too** (`order-gate-smoke.test.ts`, since
`8f0dedb`) — a grant logged, the guard finding it, the order dispatching. An
`approval/request` answerer on a booted tree returns `allowed-once` and the
stand-in order's body RUNS; `rejected`, and it does not, with dsh's own `the
user rejected tool "…"`. Its last step drops the stand-in answerer and does the
same through the real `$events` channel a browser uses. This is the test that
would have caught the 0.2.0 regression above; run it after every pin bump.

**The human half — the card — is the account-seat drill** ("The account-seat
drill" below): a person reading a seat write's card in the conversation against
the real service on a paper venue, then the Account's own Guard card. No drill
arms anything in a scratch home any more: there is no Gate 1 to arm.

**The one setting that disarms every other approval does not disarm this one.**
Under `DSH_PERMISSION_MODE=danger-full-access` — or a runtime switch to the
`danger-full-access` preset — `ApprovalService` short-circuits to `rejected`
before any answerer runs, and `dsh-tools` renders that as `the user rejected
tool "..."`, which is false: nobody was asked. The gate denies in its own words
instead, and says so.

**A cancel is gated too, and that cuts the other way.** `portfolio_live_cancel`
changes exposure, so it asks — but under policy `never`, or on a call with no
session, the gate DENIES it. The one action that reduces risk is refused in
exactly the session where prompting was switched off. That is the right trade
(the venue is paper, and you can cancel by hand from the face's Trade screen,
out of the agent's band), but it is a surprise worth knowing before you meet
it.

**The shell can answer its own card.** At 0.1.1 that took one `curl`:
`POST /api/respond` carried no token, only a same-origin check a `curl` walks
past (the roster route has the same property, demonstrated with a bare `curl`
on 2026-09-04), and the pending `rpcId` was readable off the mux stream. At
0.2.0 the answer is `POST /api/$events/result`, and it needs three things a
shell turn can still get: a browser cookie — not from the printed URL, which
only the face's stdout carries, but signed with the secret in
`$DSH_HOME/.credentials.yaml`, a file the sandbox lets it read (it confines
writes, not reads); its own `$events` generation on `/api/remote.mux`, to which
the gateway delivers every pending gate; and the gate's `eventId`, which
arrives on that same stream. With them, one un-escalated shell turn can
approve the order it just asked for, and what lands in the log is a REAL
`approval/asked` + `approval/decided` (`allowed-once`) pair. The guard is
satisfied — correctly, because a genuine grant was recorded. Nothing here is
broken; the gate asked, and the wrong party answered. The 0.2.0 path is stated
from the code, not drilled. This is the specific hole in the property the
guard was rebuilt around, so it is stated rather than left for someone to
find.

**And this is a gate, not containment.** `tools/execute` runs AFTER the guard,
is handed the execution as mutable, and the body re-resolves the tool by its
current name — so a `tools/execute` wrapper could rename a guard-approved call
into a seat write. Gravit also has an unrestricted shell. Per charter Rule 2,
this stops the model's ordinary tool calls; it is not a boundary that holds
against code trying to get around it. What it holds is the MCP tool *surface*,
not the *account*: a shell turn can read the seat's key file in the Account's
home (`~/.buyer-agent-demo/seats/gravit.json`) and sign at the Account's door
with no card here — dsh scrubs credentials from a shell's environment, not from
files. The Account's own Guard card and the paper-only limits you signed are
what bound it.

## The ask-user drill (run after any face or dsh change)

The same rule, for the seam that carries Gravit's own questions.

**What actually holds it here.** dsh-base mounts the `user-questions` SERVICE
and NO model-facing tool for it. The tool is a separate package,
`@deepseek-ai/dsh-tool-ask-user`, and upstream it reaches a session through an
agent PRESET — dsh-web-app disables dsh-base's tool rows and carries
`ask_user_question` inside each shipped preset's composition. The face keeps
dsh-base's flat tool roster (its `gravit` preset masks no host tool: the face's
`gravit.js` row and the role rows only add `role_<id>` tools), so it inherits
the one hole, and fills it with its own overlay row, `tool-ask-user` — configless,
which at 0.2.0 means the blocking `legacy` mode 0.1.1 shipped (the package also
has a `timed` mode the face does not use). It is face-owned for the same reason
`webserver` is: this layer composes last, so an operator patch aimed at it is
accepted, overridden, and never reported — and an agent silently losing its
voice is the failure the row exists to prevent.

A question reaches the browser the way an approval does: a
`user-questions/request` waterfall that `api-remotes` forwards to every
`$events` tab, keyed by `eventId`, answered with the whole batch —
`{answers: [{id, selected, custom?}]}` — through `$events/result`.

**The two halves fail INDEPENDENTLY, and that is the whole point.** A tree with
the service and no tool comes up perfectly healthy, passes `bootFace`'s Gate-2
service check, offers the model its full toolset, and simply never asks
anything. No error, no card, no pending question — just an agent that guesses.
That is what shipped from 2026-08-31 until 2026-09-02: one real session offered
35 tools, none of them this one, and ran 83 steps on a one-line brief.
`bootFace` now refuses to start a tree in which `ask_user_question` did not
register, checked against the live registry rather than the composed row list —
an unsatisfied inject leaves the row pending with the entry list unchanged.

**Unlike Gate 2 this is not a gate.** Gravit asks because it chose to, and the
answer returns as an ordinary tool RESULT — model-visible, in the context, the
exact opposite of an approval decision, which the model never sees.

**Step 0, no model, no key.** `FACE_SMOKE=1 npm test` boots the real tree and
asserts `ctx.tools.schemas()` carries `ask_user_question`;
`askuser-noclient-smoke.test.ts` asserts that a question with no browser
connected BLOCKS (parked for the next tab) rather than failing, and
`client-mux-smoke.test.ts` answers a real question with its batch through the
page's own `client/js/wire/api.js`. Run it first; if it fails, stop — nothing below can
pass and the cause is composition or the wire, not the model.

**Step 0b, if you changed anything under `client/`.** `registerStatic` sets no
cache headers, so the browser caches the ES modules heuristically and a restarted
face happily serves an old module to an open tab. Hard-reload the page before
drilling: a stale client produced two false failures while this drill was being
written.

**The drill**, with the face live and a session open:

1. `GET /data/plugins.json` (the old chat page's **plugin** panel showed it; Discover
   draws its MCP servers, not the tree) → the composed row tree. `dsh-tool-ask-user`
   is listed as `include:tool-ask-user`, phase **active**. A row stuck at
   `pending` — its inject (`tools`, `userQuestions`) never satisfied — no
   longer reaches a running face: the strict row audit refuses such a boot.
2. Prompt Gravit to ask, naming the tool: *"Use ask_user_question to ask me
   which paper venue to trade on, paper-1 or a new one. Ask nothing else and read
   no files."*
   Naming it is deliberate — this step drills the SEAM, not the judgement.
3. PASS, part one: the question card renders — an orange card with every
   question, its options, a free-answer box beside each and one Answer key. ONE card for the whole batch,
   whatever the number of questions, and one Answer: one `ask()` is one card and
   one answer, never split per question.
4. **Answer it.** The card settles to `Answered`, the turn continues, and the
   answer is back in Gravit's context as a tool result. On the stage-1 card a
   typed answer rides beside a picked option as `custom` (the old card made the
   two replace each other); at 0.2.0 nothing between the card and the asking
   tool checks the batch — at 0.1.1 the host refused a mixed answer as a bare
   `bad-response`. A press with a question left blank is refused on the status
   line (`Answer every question first`) and sends nothing.
5. **Press Stop Gravit (Details) on a fresh question instead of answering it.**
   The card settles to `Closed` — the Stop ends the turn, the gateway withdraws
   the gate with a `cancel`, and a `cancel` carries no outcome — and the Messages
   badge clears. A card that stays live after a Stop means the `cancel` is being
   dropped (`client/js/wire/api.js` `onGateGone` → `client/js/host/live.js`
   `gateGone` → the `hostGateGone` reducer).
6. PASS, part two — the instruction half, in a FRESH session: ask for a new
   strategy with a deliberately thin brief ("build me a strategy for storage
   names"). Gravit asks before it builds, per Step 0 of
   `dsh/profile/cycle.md`. This half is behavioural, not mechanical: a turn
   that answers with prose is not proof the seam is broken. Re-prompt once
   before concluding anything.
7. The log, in the session's directory
   `$DSH_HOME/sessions/<project-slug>/<session-id>/`: `session.v4.jsonl.zstd` for
   a session created or written under 0.2.0 (a pre-0.2 session keeps its
   `session.jsonl.zstd` beside it) — zstd-compressed JSONL whose first record is
   the header, `type: "session"`. A question records as an ORDINARY TOOL PAIR —
   `tool/call` with `data.name == "ask_user_question"`, and the `tool/result`
   whose `data.message.toolCallId` is that call's `callId`. There is no
   `question/asked` audit record and there is not meant to be:
   `KNOWN_SESSION_EVENT_TYPES` carries `approval/asked` and `approval/decided`
   and no question member at all, because a question is not a gate. On the wire
   a question is a `user-questions/request` waterfall and its end a `cancel`,
   both on `$events`, neither logged. The durable proof the tool was OFFERED is
   `request/header`, whose `header.tools` lists the schemas of that request:

   ```bash
   F="${DSH_HOME:-$HOME/.dsh}/sessions/<project-slug>/<session-id>/session.v4.jsonl.zstd"
   zstd -dc "$F" | python3 -c 'import json,sys
   for line in sys.stdin:
       e = json.loads(line); d = e.get("data") or {}
       if e.get("type") == "request/header":
           print("offered:", "ask_user_question" in [t["name"] for t in d["header"].get("tools", [])])
       if e.get("type") == "tool/call" and d.get("name") == "ask_user_question":
           print("called:", d["callId"])'
   ```

Until this drill passes on a live face, the face does not claim Gravit can ask.

**Drilled and PASSED 2026-09-03**, on a live face booted against a throwaway
`$DSH_HOME` with a real model, and again 2026-09-08 on the operator's own face
(34 tools offered). Exercised end to end: the tool reached the model
(`request/header` offered 26 tools including this one); Gravit called it; the
card rendered with its options; the answer returned as the tool result
`{"answers":[{"id":"pit_bed","selected":["2yr"]}]}` (step 2 then asked about the PIT beds of the
time) and the turn continued on it.
Answered here the card reads `answered`; killed with Stop, `closed · cancelled`
with the sidebar chip cleared and no resurrection on a session switch; and the
Gate-2 approval card still reads `answered · deny`, which the settle path had to
be taught to keep. Step 6 — the GRAVIT.md instruction — is the operator's to run.
Those runs were on the 0.1.1 face, where a stopped question read `closed ·
cancelled`. **On 0.2.0-rc.2: step 0 passes at `8f0dedb`; the live run is still
owed** (go-live runbook).

**Known residuals, deliberately not fixed here.** The card has no Dismiss
button, so Stop is the only exit, and plan-mode's "the user dismissed the review
to speak instead" branch — it keys on `ASK_CANCELLED` — stays unreachable from
this UI. At 0.2.0 a Dismiss is implementable: `$events/result` accepts a
`rejected` outcome, and upstream's own question panel dismisses a blocking
question by rejecting it with `ASK_CANCELLED`; the face's `answer()` sends
results only, so it is simply not built. And a question BLOCKS the turn, so an
answer typed into the composer instead of the card is queued for the next turn
rather than delivered — it says `sent` and nothing happens. Answer in the card.

## The transport drill (run after any client or dsh change)

Every byte between the page and the host is new at 0.2.0 ("The wire and the
transcript"). `client-mux-smoke.test.ts` proves the page's own wire modules against a
real host without a browser, `gravit-client-smoke.test.ts` the host layer over them;
this drill is the browser half. Hard-reload first — `registerStatic` sets no cache
headers. With the face live:

1. In a browser not yet signed in to this host:port (a private window will do), open
   the bare `http://127.0.0.1:3090/`. PASS, part one: `401`. Open the printed
   `?token=` URL: the page loads and the address bar is back to the bare URL (plus its
   `#/messages/…` route), which now loads by itself; `http://localhost:3090/` still
   answers `401` until its own token visit.
2. Open a COLD session written before the upgrade and not prompted since. PASS, part
   two: the transcript renders, and its session directory gains NO
   `session.v4.jsonl.zstd` and no `session.lock`. Prompt it: the thinking row appears —
   it is followed now — and only now do the v4 file and the lock appear.
3. Open a LIVE session, then restart the face mid-view. PASS, part three: the status
   line reads `Reconnecting… (…)`, then clears; the window is redrawn once, with no
   duplicated bubbles; the tab needs no new sign-in.
4. **New message** (the `+` on the list), a first line. PASS, part four: the
   conversation appears on the list and its reply streams without a click on its row.
5. Send `/compact`. PASS, part five: the status line shows the command's result and no
   model turn starts; a failing command shows in red.
6. Details → **Change words**, a new title. PASS, part six: the head and the row take it
   at once, and keep it after the next list refresh (the host's `title` projection).
7. Details → **Fork** on a conversation that has a completed turn. PASS, part seven: the new
   conversation opens at once with that history and lists beside its source; an empty
   conversation offers no Fork (dsh forks from a completed turn). Discover → **Gravit**: the
   provider, model and effort, the host facts of `/data/host.json` and the three keys. The old
   page's other steps — the subagent dock's **续派** and **父会话消息** (Details' Children keeps
   only Stop), the folder picker, a channel rename — are not on the gravit-ui client.

The approval endings — `Approved`, `Declined`, a second tab's `Closed`, a lost race's
`Settled elsewhere` (or, caught in flight, `answer: gate-gone` on the status line) — belong
to the Gate-2 drill; the race needs a socket dropped
mid-answer, which the go-live runbook stages by hand (§7 A) and `tests/api.test.ts` plus
`tests/client/live.test.js` cover in code. **Walked 2026-10-19** on the stage-1 client,
a face on a scratch `DSH_HOME` without keys (the ledger,
`docs/superpowers/plans/2026-10-19-gravit-face-ledger.md`): the sign-in, the empty
state, a New message in `workbench` creating, naming and prompting a session, the
missing-key error on the status line with nothing crashed, a restart and a reload
opening the now-cold session paged (`session/projections` + `session/page`, the row
still not `agentAvailable`). Steps 2–3 on a pre-upgrade session and the live reconnect
are the runbook's §7 A, on a copy of the real home.

## The bots drill (run after any face or dsh change)

A mask never pulled is presumed decorative.

**On the gravit-ui client** the bot pages are on Discover: **Create a bot** on its head, a bot's
page (model, home, soul, skills, setup issues) with **Edit** and **Talk to <bot>**; the list
groups a bot's home sessions under the bot. The steps below were written on the old chat page:
read "agent face → bots → `+ new bot`" as Discover → Create a bot, its settings page as the bot
page's Edit, "New test conversation" as Talk to, and "the sidebar" as the list.

**Step 0, no model, no key.** `FACE_SMOKE=1 npm test` boots isolated real trees.
`bots-smoke.test.ts` proves the face declares every bot directory and never `_template`, that
the roster lists a broken fixture with its reason, that the shipped relative plugin path is
rebased onto the real `plugins/bot.js`, that a session created with `agentPreset` carries it on
its header, that the bot sees exactly its allow-list ∩ the tree — including a tool registered
after the declaration — while Gravit sees the host's whole roster plus the `role_<id>` tools
(and no bot ever sees one), that the bot's prompt carries its own persona and not Gravit's while
Gravit's carries `persona.md`, and that a session naming the broken preset is refused at
`session/create` with dsh's own `agent-preset/*` error code.
`bot-runtime-smoke.test.ts` proves the saved route reaches an actual stub request without
changing the host default, that a save re-declares the preset — existing live sessions keep
their persona and model, new sessions load the new settings — and that runtime inspection
does not drive or interrupt turns.
`bot-sandbox-smoke.test.ts` and `askuser-noclient-smoke.test.ts` print one `observed:` line each
(S4, S7); their findings are recorded in the spec's amendments block.

**Step 0b, if you changed anything under `client/`.** Hard-reload; `registerStatic` sets no
cache headers.

**The drill**, with the face live:

1. Agent face → **bots** → `+ new bot`. Type a display name with spaces and capitals; PASS,
   part one: the id field shows the folded proposal, lowercase with dashes.
2. Create. PASS, part two: the bot page opens; `bots/<id>/` exists with `agent.cordis.yml`,
   `preset.yml`, `SOUL.md`, `README.md`, `skills/README.md`, `journal/notes.md`; the bot is
   usable at once — the route declared it before answering — and the boot line of a restart,
   `agent presets: …`, lists the id.
3. **New test conversation**, say something. PASS, part three: the sidebar shows the session under the bot's
   name, not under `ungrouped`; the reply speaks in the bot's persona, not Gravit's.
4. Ask the bot to list its tools. PASS, part four: it names the shell, file and web tools and
   `ask_user_question`, and does not name `subagent`, any `mcp__account__*` tool or any
   `agent_<bin>` — the default allow list names no MCP tool.
5. On the bot page, edit the soul to include `{{` and save. PASS, part five: refused with the
   strict-template message; the file is unchanged.
6. Edit the soul to something you can recognise and save. PASS, part six, with no restart:
   a **New test conversation** answers in the new persona, while the conversation from step 3,
   continued, still answers in the old one — it keeps the revision it joined — and its
   **Session inspection** reads `SOUL vs saved: Differs from saved SOUL`.
7. Clean up: `git rm -r bots/<id>` (or keep it — it is yours). The running face keeps the
   declaration until its next restart.

**Drilled and PASSED 2026-09-07 and again 2026-09-08** on the operator's own face (real
`$DSH_HOME`, the Alpaca MCP server of the time connected; `main` @ `b6dbce0` the second time).
Second run: `Growth Momentum Scout` folded to `growth-momentum-scout`; six files; the restart's boot line
listed it; the home session bucketed under the bot; the reply opened in its persona; the tools it
named were exactly the allow-list ∩ the tree — 18 offered in `request/header`, the seven
market-data reads among them and no `subagent`, `agent_<bin>` or order tool; the `{{` soul was
refused with both files byte-identical. The speaker label (R12) held on the `who` element, the
composer, the topbar and the status pulse across session switches, a reload and a restart. One
observation → R13 in `DEVELOPMENT.md` §9: every cold session lists as `untitled`. Both runs
were on the 0.1.1 face; **on 0.2.0-rc.2 step 0 passes at `8f0dedb`, and the live run —
step 6 included — is still owed** (go-live runbook).

## The room drill (run after any face or dsh change)

A room whose strip never moved is presumed decorative.

**On the gravit-ui client** a channel's page checks voices in (Bots → **Edit**, the boxes
standing for the old page's chips) and a member's answer opens its **Trace**; the participants
strip and the discussion card are not drawn, so the steps that watch them do not apply. What
holds: a room's members in the head cluster and Details, an `@` through `/data/rooms/say`, a
member's answer in the bot's voice, the round end as a line, a member's question on the room in
the bot's name.

**Step 0, no model, no key.** `FACE_SMOKE=1 npm test` boots `room-smoke.test.ts`: a stub model
route, three bots in a temp channel, one operator prompt → Gravit dispatches all three in
parallel → alpha answers, beta passes, gamma's model fails → the answer is on the room log before
the round-end wake, the wake is one turn, Gravit's synthesis is in it; every member is parented,
preset-joined, `read-only` as its first event (and its only permission pin before its first
turn), carries the channel's `GRAVIT.md` chain and lacks `dispatch`; the `room` value rides the
session row and the per-record cache file (`storages/session_projcache/sessions/<id>.json`); an
`@` turns alpha, whose write into the channel is refused inside the tool content (D12) and never
woke Gravit; a home session writes its journal and is refused on `../SOUL.md`.

**Step 0b, if you changed anything under `client/`.** Hard-reload.

**The drill**, with the face live, on the tracked fixtures — the voices `drill-bull` (看多派) and
`drill-bear` (看空派) on the channel `room-drill` — or on two template bots you create on the agent
face (the bots drill, steps 1–2) and a fresh channel. Start a NEW round either way: the room
sessions the 2026-09-09 run left in `room-drill` were written under 0.1.1, and 0.2.0 cannot open
them ("Sessions written before 0.2.0") — they fail to open, and an `@` into one answers 409.

1. Channel page → **bots in this channel** → check both in. PASS, part one: two chips read
   on; `$DSH_HOME/face/roster.log` gained a dated `bots` line; `channels.json` carries `bots`.
2. `new round`, ask a question that invites two views ("X 值得买吗？各说各的"). PASS, part
   two: the strip appears with Gravit and both voices; Gravit's dispatch card reads
   `Dispatched <A>, <B> (parallel) … Not called: none.`; both chips go `called` → `thinking` /
   `writing` → `answered` or `passed`; each answer is a bubble in the bot's own voice with its
   glyph; the round line reads `round 1 · settled · …`; Gravit wakes once and names the
   disagreement.
3. Sidebar and answer traces. PASS, part three: the room row has no Members dropdown;
   each bot's answer has a closed `思考轨迹` control at its bottom-right. Expanding it
   shows that member turn's context, thinking and tool records in place.
4. `@<bot> …` in the composer. PASS, part four: the status line reads `@ → <bot>`; the bot's
   chip moves and its bubble lands; Gravit does not speak (no new Gravit turn until you prompt
   it); the `@` shows as your own bubble.
5. Make a bot ask: `@<bot> 先问我一个问题再回答`. PASS, part five: the card appears inline in
   the room headed `<bot> asks`; the chip reads `waiting for you`; the channel header and the
   landing page's session row show the needs-you mark; answer it; the mark clears and the
   bot's answer lands.
6. Make a bot write: `@<bot> 在当前目录写一个 test.txt`. PASS, part six: no file appears; the
   bot's answer trace (or its own session, opened from the strip) shows the bash result with
   `[sandbox: file access denied under read-only mode]` — and, at 0.2.0, dsh's escalation hint
   beside it; if the bot retries with `sandbox_permissions`, an escalation card appears inline:
   deny it — and the bot reports the refusal in the room.
7. Un-check one bot on the channel page and come back. PASS, part seven: its chip reads
   `left`; `@` to it resolves nobody (the text goes to Gravit as a prompt); re-check it and
   `@` it again: the same member session answers.
8. Restart the face, open the room. PASS, part eight: the strip's coarse states survive
   (the projection cache, read by `session/projections` without activating the room); each
   answer's trace still loads its recorded member turn; no member chip moves until the room
   runs again — cold members are not followed.

**PASS criteria are observations.** Record the run below with the date and the commit.

**Drilled and PASSED 2026-09-09** on the operator's own face (real `$DSH_HOME`, the Alpaca MCP
server of the time connected, DeepSeek as the model; `feat/rooms` @ `31b2e68`), two fresh template bots
(`看多派`, `看空派`) on a fresh channel `room-drill` (all three kept since as the tracked fixtures), the question "SanDisk (SNDK) 现在值得买吗？请各说
各的". Part one: the check-in went through the channel-bots route the chips call (the landing page
is reachable only once the channel has a session); `roster.log` gained the dated `bots` line and
`channels.json` carried `bots`; the chips read on once the page existed. Part two: Gravit read the
channel, pulled the point-in-time record, then called `dispatch` — the card read `Dispatched 看多派,
看空派 (parallel), round 1 of this operator message; 2 rounds left after it. Not called: none.` —
ended its turn, both answers landed as attributed bubbles with their glyphs, the line read `round 1 ·
settled · answered: 看空派, 看多派`, and the one wake produced a synthesis that named the
disagreements first; the log order was `turn/end` → both answers → one `turn/start` → the round-end
prompt → the synthesis. The strip stayed hidden on this first round — the create path fetched no
room state (drill finding F1, fixed the same day in `31b2e68` and re-verified: a fresh round shows
`Gravit organizing · 看多派 · 看空派` with the first prompt). Part three: the room row folded `2
members`; a member's own transcript opened with its `context · room` delta row, its reply under its
own name, `Message 看空派…` in the composer, and no strip. Part four: `@看多派` read `@ → 看多派`, the
chip went `writing` then `answered`, the answer landed, and Gravit's turn starts stayed at two.
Part five: `@看空派 先用 ask_user_question 问我一个问题` raised the card inline headed `看空派 asks`, the
chip read `waiting for you`, the channel header and the landing page's session row carried the
mark; answering cleared the mark and brought the answer. Part six: `@看多派 …写一个 test.txt` — the
member's `bash` was refused inside the tool content under `read-only`, its retry with
`sandbox_permissions` raised the escalation card inline (`approval 看多派 · bash`), denied; the bot
reported the refusal in the room; no file. Part seven: un-checked, the chip read `left` and an `@`
to it went to Gravit as a prompt; re-checked, the same session answered (still `2 members`), and
the answer sent while Gravit's turn was open landed right after its `turn/end`. Part eight: after a
restart the cold listing carried the room's title and its `room` value from the cache, the fold and
the strip's coarse states survived. Three observations, none a failure: the landing page lists the
member sessions as plain `untitled` rows (shown and counted, not yet labelled by voice); Gravit,
handed an un-rostered `@` as a prompt, assumed the voice would answer — `AGENTS.md` should say that
such an `@` named nobody (the sentence landed the same day in its Rooms paragraph, and is now in
`GRAVIT.md`'s); the peer-`@` continuation was superseded by the operator's next `@` before it ran
(by design), so that path stands on the engine tests, not on this drill. That run was on the 0.1.1
face; **on 0.2.0-rc.2 step 0 passes at `8f0dedb`, and the live run is still owed** (go-live
runbook).

## The role drill (run after any face or dsh change)

A role that was never delegated to is presumed decorative. **Three roles ship**,
`cn-market-analyst`, `cn-reviewer` and `cn-stock-analyst` (all since 2026-10-26; the three before
them retired with the Python package's tools on 2026-10-24). The first works only on a `cn-market`
run, the last only on a strategy run citing one, and the reviewer on either: their live halves are
the live market and strategy runs ("Lunhui analysis"), with the steps below read for each.

**Step 0, no model, no key.** `FACE_SMOKE=1 npm test` boots `roles-smoke.test.ts` over two
fixture roles copied from `roles/_template` under the test's own roles root: `role_auditor` and
`role_worker` each spawn a one-shot child whose tool list equals the role's `allow` exactly; the
auditor's child is also checked for the role's persona (not Gravit's), the date, no roles
section, the root `GRAVIT.md` in its baseline and its text returning through the tool; a
`subagent_fork` child is assembled Gravit's system prompt and tools unchanged, a plain `subagent`
child neither the roles section nor the cycle contract; a role naming a tool the tree lacks fails
at delegation with `tools.restrict() names unknown global tool "…"` and creates no child. Its
second boot takes the shipped `cn-market-analyst` (its route turned to the stub): its tools equal
its allow list, its persona is its own, its submit lands in a run, Gravit's own submit is
`NOT_A_ROLE`, and a freeze is out of its reach. Its third boot takes `cn-stock-analyst` the same
way: exactly its allow list, its persona, its leader read citing a sealed `cn-market` run and its
submit landing with that `market_run`, Gravit's own leader submit `NOT_A_ROLE`. Its fourth boot
takes `cn-reviewer`: exactly its allow list, its persona, its read of a sealed `cn-market` run with
no `market_run` and its submit landing `counterevidence.json`, Gravit's own submit `NOT_A_ROLE`.
Run it first; if it fails, stop — the composition,
not the model, is wrong.

**The drill**, on a face booted against a COPY of the harness home with the
operator's MCP rows mounted (the go-live runbook's §7 A recipe: `DSH_HOME=$SCRATCH/dsh-drill
FACE_PORT=3091 npm start`, real keys) — never the operator's own home:

1. Start a new round in the `room-drill` channel and ask Gravit to use the role on one bounded
   task (for `cn-market-analyst` and `cn-reviewer`: in `cn-market`, the live market run's step 1;
   for `cn-stock-analyst`: in `lunhui-s01-repair`, the live strategy run's step 1). PASS, part one: Gravit calls `role_<id>` (one tool card), waits, and relays a report with
   the four headings; no card for the operator.
2. Details' Children lists one child — one-shot, so read-only history — labelled by the
   `description` Gravit gave the tool. PASS, part two: in that child's own log,
   `$DSH_HOME/sessions/<project-slug>/<child-id>/session.v4.jsonl.zstd` (its directory sits
   beside its parent's under the same project slug, the newest by mtime; the ask-user drill's
   step 7 recipe reads the zstd), the first `request/header`'s `header.tools` — the durable proof
   of what was offered — is exactly the names in the role's `role.yml` `allow`: no
   `mcp__account__*`, no `subagent`, no `role_*`; and the first `system/message` is the harness
   identity line followed by the role's persona, not Gravit's, with no `Roles.` paragraph.
3. For a role with `bash` (no shipped role has one: skip), ask for a run that sleeps 70 seconds first, past bash-sandbox's
   60,000 ms default. PASS, part three: in the child's log, the run's `bash` call either passed a
   `timeoutMs` above 60000 and returned in the foreground, or its result reads `[still running
   after 60000ms; moved to background job …]` and a `job_output` (or `job_kill`) on that job comes
   before the child's last reply — never a report written while its job still ran.
4. For a role that names an MCP tool (no shipped role names one; disabling one of its module
   rows, `- { id: lunhui-theme, disabled: true }` for `cn-market-analyst`,
   `- { id: lunhui-mode, disabled: true }` for `cn-stock-analyst` or
   `- { id: lunhui-review, disabled: true }` for `cn-reviewer`, makes the same refusal): in the scratch copy's `profiles/face/cordis.patch.yml`,
   disable that server's row (`disabled: true`) and restart the face. Killing the server's process
   is not enough: `dsh-mcp-client` reconnects and keeps the tools registered through the outage.
   Ask for the role again. PASS, part four: the tool result reads `Error: tools.restrict() names
   unknown global tool(s) "…"` naming the missing tools, and no child appears; the face itself
   booted regardless. Restore the row and restart.
5. In Gravit's own log (step 2's recipe on the parent session) the first `request/header` lists
   `role_<id>` beside the host's tools, and the first `system/message` carries the `Roles.`
   paragraph with each role's one-line summary; the boot line `agent presets: …` shows `gravit` without a
   `(broken)` mark (a role row that fails to mount lists the default broken, and the boot
   refuses). PASS, part five.
6. Clean up whatever the role wrote under `strategies/room-drill/` (for `cn-market-analyst` and
   `cn-reviewer`, the run under `strategies/cn-market/analysis/`, for `cn-stock-analyst` the one
   under the strategy's `analysis/`; `git status` shows it).

**PASS criteria are observations.** Record the run in `DEVELOPMENT.md` §7.4 with the date and the
pin.

**Not yet run live.** Step 0 passes on the fixture roles at stage 3 (2026-10-24), with both
analysts since 2026-10-26 and with the reviewer since plan 4 the same day; steps 1, 2, 4 and 5 are
owed with each, and step 3 waits for a role with `bash`.

## The cycle drill (run after any change to cycle.md, roles/ or the dsh pins)

On the operator's face (`cd face && npm start` with the keys; the real Account running with a
paper venue, the seat admitted as **Gravit** with a `trade` limit on it — "The Account seat"),
not a scratch home: the drill writes a strategy directory, places paper orders, and the operator
judges the result.

1. `+ new` on a channel created from `_template` for the drill (`cycle-drill-<date>`). Send one
   message: an idea in two sentences, no brief. Expected: ONE ask_user_question batch — thesis,
   falsification terms, the paper venue and the window the forward trade runs over, what to
   measure — and no file written before it.
2. Answer the batch. Expected: Gravit calls `create_goal` (the chat shows the goal), writes
   THESIS.md and `status: researching`, then rounds follow by themselves: the chat shows a round
   header per round — the client's collapsed `context · goal` row, whose summary reads
   `<goal_round>` and whose body carries the objective and `Round: n/24` — reads through the seat
   (`mcp__account__portfolio_*`, AKShare among them), a forward paper trade on the granted venue (Gate 2's
   card in the conversation, then the Account's Guard card in Account › Cards — answer both;
   Gravit waits with `portfolio_wait`), and dated journal entries carrying the Account's own
   figures and the order ids. No role call and no backtest. No other card — Gravit commits
   nothing inside the rounds, where a commit outside the sandbox fence would raise one and stall
   the run; no question after step 1 unless the venue cannot cover the window asked.
3. The verdict: `status.yaml` reads `validated` or `retired` with the terms cited and the goal
   complete, or `researching` with the goal blocked — never completed — on a reason whose first
   word is `venue-window`, `data-missing` or `needs-operator` (the code
   `model-reported`), or on the code `round-limit` when the 24 rounds are spent; `one_line`,
   `next`, `numbers` filled; the journal's last entry is the verdict, ending in a usage line
   Gravit's closing message asks you to fill from the session-usage card; at most one commit,
   with the verdict (that commit raises the approval card — answer it; beside the order cards it
   is the cycle's only card). `/goal` in the composer prints it on the status line — `Status`, the
   `Blocker` code and reason, `Rounds: n/24` — and the record is the log's last `goal/change`,
   read with the ask-user drill's step 7 recipe filtered on that type.
4. Restart: stop the face mid-cycle on a second drill channel, start it again, send "continue".
   Expected: Gravit reads the goal (`get_goal`), calls `update_goal` with `resume`, and the
   rounds continue; the goal did not continue on its own after the restart. The Stop button
   during a round is a different path: it PAUSES the goal, which only you can resume — Gravit
   asks you to type `/goal resume`; a round that errored or ran out of tokens only disarms the
   goal, and "continue" re-arms it as after a restart.
5. Record: rounds used (`/goal` prints `Rounds: n/24`), the paper orders placed (the statement
   names Gravit), wall time, the session's usage (the agent panel's "session usage" card, the line step 3's
   journal entry asks for), and the first-request numbers for Gravit's session, read from `$DSH_HOME/storages/session_projcache/sessions/<id>.json` — the
   `contextBreakdown` row (heuristic tokens) and, beside it, `tokenUsage` (the provider's own
   usage) — into `DEVELOPMENT.md` §4.3 and §7.4 with the date. `<id>` is a session's id, the
   name of its directory under `$DSH_HOME/sessions/<project-slug>/`: take the newest by mtime,
   and confirm it holds `session.v4.jsonl.zstd` whose last `goal/change` names this drill's
   objective (step 3's recipe).

**PASS criteria are observations.** Record the run in `DEVELOPMENT.md` §4.3 and §7.4 with the
date and the pin.

**Not yet run live.** The automated half passes at `fae4f61` (`cycle.test.ts`,
`goal-smoke.test.ts`, and the cycle assertions of `bots-smoke` and `roles-smoke` under
`FACE_SMOKE=1 npm test`), `cycle.test.ts` again on the new text at stage 3 (2026-10-24); steps 1–5
are the operator's.


## The account-seat drill (run after any change to the seat, and before the branch lands)

The operator's keyed run of the two-card path on a real model. Needs: the Account service up
with writes on and a paper venue (`paper-1`), the face started with keys and its page signing for
the Account, the seat let in as **Gravit** with a `trade` limit on the paper venue (both from
Account › Agents, "The Account seat" above), a channel session.

1. **The standing.** Account › Venues: the Account seat box reads `127.0.0.1:4820 · reachable` (the
   host of `FACE_ACCOUNT_URL` on the host loop),
   `Guard · Trading on · $1 a move`, `Gravit · admitted until <date>`, `trade · paper-1 · $<n> an
   order · $<left> of $<budget> left`, the paper venue with its `Paper` chip, no cards. Discover's
   MCP shelf lists `account` with 36 tools.
2. **The read.** Ask Gravit: "What is my seat at the Account, and which paper venues are there?"
   Expect no card and an answer naming the seat as authorised and `paper-1` (the call,
   `portfolio_account`, is not drawn in the thread).
3. **The order.** Ask: "Buy $10 of AAPL on paper-1, market." Expect, in order: the face's orange
   card `Your call: buy $10 of AAPL · market · paper-1` with the dim line `paper-1 · Account seat
   - mcp__account__portfolio_live_order: side=buy usd=10 symbol=AAPL …`; press ✓; the
   receipt `Card raised · card-NNNN · answer it under Account › Cards`; the
   Venues box counting `1 card waiting`. A model left to itself previews first
   (`portfolio_live_markets`, `portfolio_live_preview`: reads, no card); the card's title is made
   from the dim line, the host's own words, so it never waits on anything else.
4. **The Account's card.** In the face's Account › Cards (Waiting for you) — or through the seat
   box's **Answer under Cards** — the card `Gravit asks to PAPER · buy … AAPL at paper-1 …`;
   **✓ Approve** and sign. Gravit's `portfolio_wait` returns
   `done`; the Account's statement shows the fill marked paper; on Refresh the Venues box drops
   back to no cards and the limit's `left` falls by the order's worth.
5. **The refusal.** Ask: "Sell $10 of AAPL on okx, market — place it, no preview." (Left to
   itself a model previews, reads the door's `wouldBe: refused` and places nothing — no card either
   way.) Expect the face's card (the venue `okx`) and, on ✓, the Account's refusal
   `E_MANDATE_RECIPIENT · the trading limit does not cover "okx" (…)` as a red refusal line — no
   card under Account › Cards, nothing placed.
6. **Decline.** Ask for another paper order and press ✗: the tool answer is dsh's `the user
   rejected tool "mcp__account__portfolio_live_order"`, nothing reaches the seat (Account › Cards
   shows no new card).
7. **The hang.** Stop the service and in its place start a listener that accepts and never answers
   (`node -e "require('net').createServer(()=>{}).listen(4820,'127.0.0.1')"`), then start the face:
   the boot stalls about two minutes — the seat's startup GET of `/api/account` has no timeout of
   its own (`account/src/portfolio/mcp.ts`, unchanged from 133b9a7), so its MCP `initialize` never comes and dsh waits
   out the MCP SDK's 60 s request timeout twice, once for its probe process and once for the serving
   one (measured: 123 s) — then comes up with the `mcp-account` row active and no seat tools: the
   boot line has no `order gate armed for mcp__account__…`, Discover's MCP shelf lists `account`
   with 0 tools, and Account › Venues reads `not reachable` within seven seconds (`timeout`). Stop
   the listener, start the service, restart the face. Bounding that GET is a one-line change in
   `account/` (`AbortSignal.timeout` in `call()`), not made; the face cannot bound a child's first
   request.

**PASS criteria are observations.** Record the run in `DEVELOPMENT.md` §7.4 with the date and
the tree's commit (`git rev-parse --short HEAD`).

**Run 2026-10-21 on the stand-in, not the real service** (buyer-agent-demo @ 133b9a7, its
`ui-standin --no-desk` on 4821, the face on 3097 from a scratch home with `DEEPSEEK_API_KEY`,
`deepseek-flash`): steps 1–6 observed — the box `not on the account` → `knocking` after the first
read → `admitted until Nov 20` with `trade · paper-momentum · $25 an order · $90.63 of $100 left`
after the fill; the read answered by three seat reads and no card; the order previewed by the
model, then the face's card, ✓, `Card raised on the Account page · card-0002` (that day's receipt), the Account's card
signed on its page, the fill read back through `portfolio_approval` (ord-0014, 0.00015 BTC at
62,457.8, paper); the `ex` order refused by the model at its own preview and, placed on request,
refused by the Account `E_MANDATE_RECIPIENT · the trading limit does not cover "ex" (it covers
paper-momentum)`; a decline answered `the user rejected tool "mcp__account__portfolio_live_order"`
with nothing on the Account page. Two client defects found that day and fixed (the card drawn
before its `tool/call` arrived, dsh's `Error: ` prefix on a refusal), and one model fact for the
record: the model once reported an ask it had not filed, and corrected itself on its next read.
The automated half passes (`account-seat-smoke` under `FACE_SMOKE=1` with `FACE_ACCOUNT_SEAT_DIR`);
the keyed run against the real service with a real paper venue is the operator's, before the
branch lands.

**Run 2026-10-27 on the real service, reads only** (buyer-agent-demo @ 133b9a7 serving 127.0.0.1:4820 with
`--read-only --home ~/.openpaper`, the face at 92c5a0c on 3090 from the live home with `DEEPSEEK_API_KEY`,
`deepseek-v4-pro`, a conversation in the workspace channel): the read half of steps 1–2 observed — the boot
line `[agent-portfolio-manager] up (stdio) → http://127.0.0.1:4820` and the gate armed for the nine seat
writes; `/data/seat.json` `reachable`, `writes.on` false, the seat `Gravit · absent` (a read is an unsigned
GET and does not knock — the Account's agents list stayed empty and no key file was made), `paper-linqi` at
$10,000, no cards; Gravit asked for a read-only AAPL quote answered with `portfolio_explore` (tab=stocks,
q=AAPL, limit=3) and `portfolio_book` (paper-linqi, AAPL) and no card: AAPL 347.19, bid 347.2 / ask 347.23,
`Nasdaq · real time` at 19:30:00Z, both venues (`cboe`, public, and `paper-linqi`) quoting the same; the same
service read directly a minute later gave 347.35 `Robinhood · real time` — the quote moves with the market
and names its source, which the stand-in's fixtures never do. `portfolio_quote` is not among the seat's
tools on a real account (the simulated statement's router, offered only there — `src/portfolio/mcp.ts`,
`REAL`). Steps 3–7 (the order, both cards, the refusal, the decline, the hang) are still not run: they need
the service started with writes on and the seat admitted as **Gravit** with a `trade` limit on the paper
venue.

## The owner drill (run before the branch lands, and after any change under account/)

The face's page as an owner device of the real Account — "The Account in the face" above, the
design's §10. **Paper venues only**: connect no real venue to the Account for this drill, and keep
`--live-cap 1`. Needs: the Account service on 4820 with writes on (`npm run account -- --live-cap
1`); **a face browser that already signs for it** (`cd account && npm run account:owners` says
`face-signs`, or `ownerless` and the first face browser pairs with the printed code; that browser's
device line reads `This page signs for the account`) — since the Account's page retired nothing
else lets a browser in; the face started with keys and the seat row up (for step 7, the seat let in
as **Gravit** with a `trade` limit on a paper venue — "The account-seat drill"); and a **second face
browser** that has never paired with the Account — another browser or browser profile, the key
being per origin and per profile.

1. **Waiting.** In the second browser open Account. The device line under the head reads `Waiting
   to be let in — a browser that signs lets it in, under Settings › Devices`; no owner key is drawn
   anywhere (Venues, Agents, Cards, Rules' signed rows, Money's, Trade's ticket, a market's Buy).
2. **Let it sign.** In the first browser, Settings › Devices lists the second as a browser waiting
   (`<kid> · since <date>`); press **Let it sign** and sign. Back in the second, within a read (20 s,
   80 s while the stream is open — or press Refresh) the line reads `This page signs for the
   account`, and the keys appear; Settings › Devices in either lists both devices, each marking its
   own `this page`. Keep both paired after the drill: a second device is the way back from a lost
   profile (`DEVELOPMENT.md` R53).
3. **A watch.** On Markets, star a crypto row you are not watching: one press, no sheet. Expect
   the star on in this browser and on the same row in the other face browser after its next read
   (the Account's watch list, which Gravit's seat reads too); star it off and it leaves both.
4. **A paper account.** Account › Venues › **Open a paper account**: a name, $10,000. The sheet
   prepares and shows **What you sign** (`connectVenue`, `live:paper`, the venue id, the dollars,
   the nonce); sign. The paper venue appears under Venues with its `Paper` chip.
5. **A paper order.** Trade → Crypto → a coin the paper venue trades → Where: the paper line
   (`Paper`) → Buy, `10` dollars, Market. Expect the Account's quote, the countdown `Your signature
   is good for 9:5x more.`, What you sign (the seventeen fields and the nonce); change the amount
   and see What you sign dim and Sign and place go off until it is prepared again; **Sign and
   place**. Expect `ord-… · filled` (or `open on the book`), the fill told under Under way, and the
   asset in Portfolio under the paper book.
6. **A cancel.** Place a limit buy well under the market on the paper venue; it rests in Under way;
   **Cancel** (one press) and see it `canceled`.
7. **Gravit's order, two cards.** In a channel, ask Gravit to buy $10 of a stock on the paper venue
   the seat's `trade` limit names. Expect the face's Gate 2 card in the thread (✓), then the
   Account's Guard card in the face's
   Account › Cards — What it asks every field — and **✓ Approve** there (the sheet, What you sign,
   Approve). `portfolio_wait` returns done in the thread.
8. **The statement.** Account › Statement: your order's line reads `You`, Gravit's `Gravit,
   approved by you`.
9. **Sign out.** In the second browser, Settings › Devices › **Sign out** (the sheet: `signOut`,
   this device; sign). Its line reads `Signed out` with **Sign in**; its owner keys are gone; the
   first browser's Settings › Devices no longer lists it. Never sign out the last device that signs
   unless you mean to pair again: the Account then prints a new pairing code in its terminal.
10. **The smokes.** Run `account-seat-smoke` and `account-graft-smoke` against the repo's `account/`
    ("The Account seat", "The Account in the face").

**PASS criteria are observations.** Record the run in `DEVELOPMENT.md` §7.4 and the ledger
(`../docs/superpowers/plans/2026-10-22-account-graft-ledger.md`) with the date and the tree's commit
(`git rev-parse --short HEAD`). **Not yet run** — owed to the operator.

## The two-parts drills (run after plan 5 of the Account's two parts, and after any change to the Account's markets, its sidecar or its rules)

The live half of `../docs/superpowers/specs/2026-11-01-account-two-parts-design.md` (§4.5, §5.9):
A shares, Lunhui and AKShare through the Account, the wallet half on the face, the Account with no
page, and the two boxes. The offline half passes in the suites (`tests/no-market-hosts.test.ts`,
`tests/no-account-page-words.test.ts`, `tests/compose.test.ts`, the proxy and client tests, and
the account suite with no known red). **Paper venues only**, on 4820 and on `~/.buyer-agent-demo`:
the real-money paths (a browser wallet, a venue's sign-in, Move, Earn) are drilled on the stand-in
alone. Common needs: the host Account restarted from this tree on its default home, its start
line sourcing the iFinD file (`set -a; [ ! -f ../.env.ifind ] || . ../.env.ifind; set +a; npm run
account …`, "Run" above), the face restarted from this tree without it, the browser hard-reloaded,
and a face browser that signs (`npm run account:owners`, "The owner drill").

1. **China on the Account.** Needs: the Account with writes off or on; a market session in
   Beijing, or any time for the closed state.
   1. Markets › China: rows in CNY with the session phase in the state line (`Tencent · Live`,
      `Midday break`, `Closed`).
   2. Search `600519`: it is found, among the other markets' hits.
   3. Open it: the tile, `A-share · 600519 · SH`, the twelve facts (`CN_FACTS`: Previous close
      through Amplitude), and Price history's 1D and 5D minute lines and 1M–MAX bars.
   4. Star it: on a page that signs the star lands in the Account's watch list (`portfolio_account`
      reads it, or the other face browser's star).
   5. Stop the Account: China says `The Account is not answering · China as last read`, the page
      `The Account is not answering · as of MM-DD HH:MM Beijing` over its last price — no stale
      price unmarked, never `Delayed` or `Closed`. Start it again.

   PASS: every row and figure drawn is the Account's, and the face asked no market host (its
   process's egress is the Account alone).
2. **A Lunhui market run through the Account.** Needs: the Account started with the iFinD file
   sourced (its start line says whether iFinD is configured), the face without it.
   1. In the `cn-market` channel ask Gravit for a market read; the run seals.
   2. Its evidence files under `strategies/cn-market/analysis/` say `via: "account"`.
   3. The boards come from Eastmoney or, when Eastmoney fails, from the iFinD stand-in
      (`POST /api/cn/ifind`), the provenance saying which.
   4. Stop the Account and ask again: a freeze refuses (`UPSTREAM_INVALID`, naming the Account) and
      the modules that needed it read `NOT_EVALUABLE`. Start it again.

   PASS: the run seals as before with every upstream read relayed (`/api/cn/relay`); the face's
   start line sources no iFinD file.
3. **Gravit asks AKShare through the seat.** Needs: `akshare-mcp` installed on the host
   (`../account/README.md` "AKShare, the sidecar").
   1. `curl -s 127.0.0.1:4820/api/akshare/tools` lists 14 tools.
   2. In a channel ask Gravit an A-share question (a spot snapshot, say): it answers with
      `portfolio_akshare` (`{tool, arguments}`), and no card is raised.
   3. `/data/plugins.json` and Discover's MCP shelf: `account` with its 36 tools; no `akshare`
      server, and Gravit's tool list has no `mcp__akshare__*`.

   PASS: AKShare's answer reaches Gravit through the Account alone.
4. **Rules on a `--read-only` Account.** Needs: `npm run account -- --read-only`.
   1. Account › Rules: **Each move at most**, **Agents' session** and **Their leverage** (where
      offered) each say `Read-only: the Account was started without trading, so there is no …`.
   2. **Mode** is as the Account answers it; on Beast, **Guard** is one unsigned click and the chip
      reads `Guard` after the next read.

   PASS: no row offers what the Account cannot take.
5. **Rules on a writes-on Account with a paper venue.** Needs: `npm run account -- --live-cap 1`,
   a paper venue, the seat let in as **Gravit** with a `trade` limit on it.
   1. Guard ⇄ Beast: Beast is a signed sheet (`Sign Beast`), Guard one unsigned click; each read
      back in the head's chip.
   2. **Each move at most** (`Sign the cap`), **Renew for 30 days** on the agents' session, **Their
      leverage** (`Sign leverage`): each read back in its row.
   3. In Beast ask Gravit for a paper order: the face's Gate 2 card still comes first in the
      thread; no Account card follows. Switch back to Guard.
   4. The fifteen items of the spec's §5.1 on the face (§5.9): Close…, Change… and Leverage… (a
      market's page, the Portfolio; Change… on Trade), a market's You here, order book, latest
      trades and a perpetual's funding; Rules; Close to agents and Reopen…; Sell many; opening an
      agent wallet; every limit scope and Gravit's own row; every ask granted; Sign out's Guard
      first — on the paper venue, where each can be done there.
   5. The rest only on the stand-in, never on 4820: every connector but a paper account (a key
      file, an address, the command-line connector, a browser wallet, the Robinhood sign-in), an
      agent wallet's Top up… and Take back…, Receive, Move and Earn. The stand-in:
      `cd account && npx tsx test/standin/ui-standin.ts --port 4821` (at its default cap; `--cap
      <usd>` sets another), a face started with `FACE_ACCOUNT_URL=http://127.0.0.1:4821` on a
      scratch home. Observed: each sheet started, prepared and shown on the face and signed against
      simulated venues. The stand-in reaches no network, so a venue's sign-in is expected to end at
      its start (expected, not yet observed: how that start fails with no network, a quick refusal
      or a wait to a timeout, is the drill's to see): the sign-in sheet shows the Account's refusal
      on the face, and no venue page, redirect or callback follows.

   PASS: each signed act shows What you sign before the signature and is read back from the
   Account; nothing moves on a real venue.
6. **The page gone.**
   1. `curl -s 127.0.0.1:4820/` answers 404 with `NO_PAGE` (`The Account serves no page: its
      owner's screens are Gravit's face (Markets, Trade, Account). …`).
   2. On the stand-in's face (as in drill 5), the sign-in sheet started from Account › Venues ›
      Connect an account shows the Account's refusal on the face (expected, as in 5.5). Then open
      `http://127.0.0.1:<the face's port>/data/account/signin/callback?state=drill` in that browser:
      the Account's HTML answer (`this sign-in is not one this server started, or it ran out: …`)
      is drawn on the face's origin under the callback's content-security-policy. A sign-in run to
      completion against the host 4820 Account with network would connect a real account: that is
      not part of this drill.

   PASS: nothing at the Account answers but its API; no face sentence sends the operator elsewhere.
7. **The two boxes with 4820 unpublished** — "The two-box drill" below.

**PASS criteria are observations.** Record each run in `DEVELOPMENT.md` §7.4 with the date and the
tree's commit (`git rev-parse --short HEAD`). **First run 2026-11-01 on `2697cdcd`** — drills 1, 2.1–2.3, 3, 4, 6 and 5 in Guard passed; Beast and the other Rules signatures, most of 5.4–5.5, and 7 not run; four findings recorded in `DEVELOPMENT.md` §7.4, all four fixed since and re-run live on `fdfd3402` (2.4's words checked over the freezes' fetch path, not through Gravit).

## The two-box drill (run before the branch lands, and after any change to compose.yml or a Dockerfile)

The isolated run: the face and the Account as two boxes (`../compose.yml`, `Dockerfile` and
`docker-entrypoint.sh` here, `../account/Dockerfile`; the design's §5 and §7). The host dev loop —
two host processes — stays the default; this run is started on purpose, with Docker Desktop's
daemon up. **Stop the host face first**: the agent box alone publishes 3090 on the host's
loopback, which the host dev loop holds; the account box publishes nothing (stopping the host
Account too is advised, one Account in sight, not required). Run every `docker compose` command at the repo
root: the agent box mounts an allowlist of the repo's paths under `${PWD}`, so the tree lands at
its own host path. On macOS a repo under `~/Desktop` needs Docker Desktop's Settings › Resources ›
File sharing (Files and Folders › Desktop access), or the binds read EPERM. The model key comes
from `../.env.deepseek` through `env_file` into the face's process env (optional; absent, the face
boots and Gravit cannot answer; dsh scrubs `KEY`/`SECRET`/`TOKEN` names from every child it
spawns, so Gravit's shell never inherits it). It carries the model key only; the Account box's A-share
reads need no key (Tencent, as on the host). Never paste `docker compose config` output anywhere —
it prints the `env_file` values resolved.

`agent` (the face, dsh, Gravit's shell, the seat) mounts an allowlist of the tree, never
its root: read-write `face/`, `strategies/`, `bots/`, `roles/`; read-only `account/` (the account
box's build context and the seat's code — its `node_modules` is the writable `account-modules`
volume), `dsh/`, `docs/` and the root documents `GRAVIT.md`, `CLAUDE.md`, `AGENTS.md`,
`Gravit-Design.md`, `DEVELOPMENT.md`, `ROADMAP.md`; an empty read-only `.git` (a tmpfs, the
root marker dsh's instruction files climb to, so `GRAVIT.md` reaches every session — no history in
the box). **By design the root's `.env*` files (a venue's keys among them), `GRAVIT.local.md`
and `compose.yml` are not in the box.** Beside them: `dsh-home`, `seat-home` (the seat's
`BUYER_HOME`, holding `seats/gravit.json`) and the two module volumes — **no docker socket and no
path of the Account's home**. That fence is on files: on Docker Desktop `host.docker.internal`
still reaches the Mac's loopback services from the box — no wider than the host dev loop, and no
Account secret. `account` runs the in-tree service with
`--home /data` on `account-home`. Only the agent box reaches `http://account:4820`, over the `gravit`
network; the account box publishes no port; the agent waits for the account's health check (`GET /api/overview`, its HTTP status).
The box sets `FACE_BIND=0.0.0.0` so the face listens on the container's interface. **`FACE_BIND`
is for the box only**: the `/data` routes' `Host` fence is the DNS-rebinding defence, not
authentication, and `FACE_BIND=0.0.0.0` on the host Mac would serve them to the LAN to any peer
that forges `Host`. The same holds for the Account's `PORTFOLIO_BIND` (`../account/README.md`).

1. **Up.** First `cd account && npm ci` on the host (the dev loop needs it anyway): the
   `account-modules` volume mounts inside the read-only `account/` bind, so its mount point
   `account/node_modules` must already exist. Then `docker compose up --build`. The first up
   runs `npm ci` into `face-modules` and `account-modules` (Linux binaries; it needs the network)
   and `npm run setup` into `dsh-home`.
   Expect the face's boot line `gravit-face: http://127.0.0.1:3090/?token=… (profile: face) ·
   listening on 0.0.0.0` and the seat's `[agent-portfolio-manager] up (stdio) →
   http://account:4820`.
2. **Pair.** `docker compose logs account` prints the code; open the face's tokenized URL,
   Account, and type the code at "Pair with the code the Account printed in its terminal"; open
   a paper account from Account › Venues on the face (the volume starts empty — or carry the
   host's home in first, `../account/README.md` "In the box").
3. **The fence.** `curl -s -m 3 http://127.0.0.1:4820/api/now` fails (nothing listens on the
   host), and `docker compose exec agent node -e "fetch('http://account:4820/api/now').then(r=>console.log(r.status))"`
   prints 200.
4. **The standing.** Open the tokenized URL. Account › Venues: the Account seat box reads
   `account:4820 · reachable` (expected, not yet observed); on an empty `seat-home` the seat
   reads not on the account, then knocking after Gravit's first seat call, until you let it in
   under Account › Agents on the face as **Gravit** ("The Account seat" above). Discover's MCP shelf lists `account`
   with its 36 tools and no `akshare` card; the CLI agents (`claude`, `codex`) read unavailable.
5. **The read.** Ask Gravit for a read-only AAPL quote: `portfolio_explore` (tab=stocks, q=AAPL)
   answers with no card, as in the 2026-10-27 drill on the real service ("The account-seat
   drill" above).
6. **AKShare in the box.** Ask Gravit one AKShare question; `portfolio_akshare` answers with no
   card.
7. **The negative.** `docker compose exec agent ls /data` fails (no such file or directory: the
   Account's home is not mounted there), and `docker compose exec agent ls /var/run/docker.sock`
   fails too.
8. **Down.** `docker compose down` (the volumes stay; `down -v` drops them, the box's Account
   home with them).

After a pull that changes `face/package-lock.json` or `account/package-lock.json`: `docker compose
down`, then `docker volume rm` the project's `face-modules` and `account-modules` volumes
(`docker volume ls` names them `<project>_face-modules`, `<project>_account-modules`), so the
entrypoint's `npm ci` reinstalls on the next `up` — it installs only into an empty volume. A
change to `account/` itself also needs `docker compose build account`: that box copies the tree
at build. After a pull that rewrote one of the root documents (`GRAVIT.md`, `CLAUDE.md`, …),
recreate the box (`docker compose up --force-recreate agent`): a single-file bind pins the old
inode.

**PASS criteria are observations.** Record the run in `DEVELOPMENT.md` §7.4 with the date.
**Not yet run** — the daemon was off when the boxes were written (2026-10-27).



## The desk drill (run after any change to scripts/service.ts, scripts/desk.ts, src/desk*.ts, src/telegram.ts, src/us-quotes.ts, src/{schedule,firing,standing,producer,market-clock,brief}.ts or main.ts's exits)

The desk spec's drill (`../docs/superpowers/specs/2026-10-19-always-on-gravit-design.md` §9 and
§12), in three parts so far: P0's, the face as a service; P1's, the phone and the Desk panel; and
P2's, the clock and the pre-close brief.
**Since the merge onto main (2026-11-01)** the steps below are as written for the desk's branch,
and three things read differently on the merged tree: the Desk panel's steps (P1's 4, 6 and 8,
P2's 2 and 3) have no panel until its gravit-ui port (P3) — read `npm run service -- status`,
the phone's `/status` and the ledgers instead; a price asked of the desk (P1's step 1) and the
brief (P2's step 2) come from the Account's market read, so the Account must be running
(`npm run account`); and the calendar needs no interpreter. The drill is to be run again on the merged tree.
It is the operator's, never an agent's — every step drives the operator's own launchd, harness
home, bot and phone.

### P0: the service

PASS is P0's done criterion — the face has survived a `kill -9` and a login without a terminal,
and a second face has booted beside it, on a scratch home, with `FACE_DESK=0` — and one thing
more: the service's face works, not only survives.

**The automated half, no launchd.** `npm test` runs `tests/desk.test.ts` (the ledger, its runs,
the sleep watch, the status and its fenced route) and `tests/service.test.ts` (the plist, the
home's `.env`, the status text, and every command against a fake `launchctl`); `FACE_SMOKE=1
npm test` mounts the desk on a real tree (`smoke.test.ts`). What only this drill checks: that
launchd accepts the commands the script sends — `enable`, `bootstrap` and `bootout` (no step
reaches `start`'s `kickstart`, which runs only for a loaded job that is not running); that
launchd's real `print` text parses for the job's state and pid, and that the pid is the face's
own, the one the ledger's `boot` line carries; that the face writes its `shutdown` line within
launchd's stop timeout on `stop` and `restart`; and that the face works under launchd — macOS
lets node read the checkout, and the plist's `PATH` and the home's `.env` carry what a prompt
and a quote need.

**The drill**, from `face/` in the primary checkout with the work merged there, from the shell
you run the face from ("Run as a service"), and no other face on 3090:

1. `npm run service -- install`. PASS, part one: it prints `installed: …`,
   `runs: <the primary checkout>/face/src/main.ts`, `home: …`, `node: …` and `log: …` (read its
   `not in`, `not copied` and `privacy:` lines, "Run as a service"); `npm run service -- status`
   says `com.gravit.face: running (pid N)` and, once the face is up,
   `answering at http://127.0.0.1:3090 · … · desk on`; `npm run service -- url` prints the
   `?token=` URL, and the browser opens the chat with it. And it works: `face.err.log`
   (`npm run service -- logs`) holds no `EPERM` — if it does, allow node's privacy prompt or
   grant node access ("Run as a service", first install), and launchd's next start, within
   30 s, reads the checkout; and one prompt is answered in the browser.
2. `kill -9 N`, the pid `status` printed — the face's own: the last `boot` line in the ledger,
   `$DSH_HOME/face/desk/events.jsonl` (`~/.dsh` unless `DSH_HOME` is set), shows the same
   `"pid":N`. PASS, part two: within about 30 s, `status` says `running` with a new pid and
   `last run: lost (killed or crashed; no shutdown event)`. Observe, too, that no MCP child of
   the killed run is left: `pgrep -fl akshare-mcp` shows only the
   new run's, whose parent (`ps -o ppid= -p <pid>`) is the new pid — never `1`. Record what you
   see.
3. `npm run service -- restart`. PASS, part three: it prints `stopping the running job to start
   it again: …` and `started: …`; `status` says `running` with a new pid and
   `last run: ended … code 0`; the ledger shows a `shutdown` line with the pid `status` showed
   before the restart and `"code":0`, then the new `boot` — the old run ended, it was not lost.
   `restart` stops the face as `stop` does, with launchd's `bootout`, then bootstraps it again,
   so a `last run: lost` here means launchd stopped the face without SIGTERM — a finding, and it
   belongs in the drill record.
4. `time npm run service -- stop`. PASS, part four: `status` says `com.gravit.face: not loaded`
   and `not answering on 3090`, and its ledger line reads `ledger: last boot … - ended … code 0`.
   Record how long the stop took — the face's real exit against the script's 10 s wait
   (`DEVELOPMENT.md` §9, R55); a `launchctl bootout … failed` followed by `not loaded` means the
   face took longer than that wait. Then `npm run service -- start`; `status` says `running`
   again.
5. Log out and back in, and start no face. PASS, part five: `npm run service -- status`, from a
   new terminal, says `running` with a new pid — launchd started it at login.
6. A second face beside it, on a fresh scratch home:

   ```bash
   SCRATCH_HOME=$(mktemp -d)
   DSH_HOME="$SCRATCH_HOME" npm run setup
   FACE_DESK=0 FACE_PORT=3091 DSH_HOME="$SCRATCH_HOME" npm start
   ```

   PASS, part six: it boots and prints `gravit-face: desk: rows disabled (FACE_DESK=0)` and its
   own sign-in URL on 3091; `curl -s http://127.0.0.1:3091/data/desk/status` reads
   `"enabled":false`; the service's `status` still says `running` on 3090. Stop it with Ctrl-C
   and `rm -rf "$SCRATCH_HOME"` — it holds a `.credentials.yaml`.
7. Optional — a real sleep. `pmset sleepnow`, and wake the Mac after more than 2 minutes. PASS,
   the optional part: `npm run service -- status` shows `asleep: 1 gap(s) since boot` — one gap
   more than before the sleep, if this run already had one — and the ledger an `asleep` line
   whose `gapMs` spans the sleep.

**PASS is steps 1–6; step 7 is optional.** Record the date, the commit, step 4's stop time,
step 2's observation and, when it ran, step 7 in `DEVELOPMENT.md` §7.4's **Desk** row.

**Not yet run.** The automated half passes 2026-10-20; nothing has run against the real
launchd.

### P1: the phone and the Desk panel

PASS is P1's done criterion — the operator has talked to Gravit from the phone, asked a live
price and got it, and the Desk panel shows it — and the edges a phone meets: a pause, a fresh
conversation, a long answer, a turn cut by its deadline, a `/stop` with a text queued behind it.

**The automated half, no Telegram.** `npm test` runs the desk's suites — `desk`, `desk-cli`,
`et`, `desk-preset`, `desk-tools`, `desk-guard`, `desk-session`, `desk-conversation`,
`telegram`, with the desk's cases in `http`, `orders`, `cycle`,
`gravit-plugin`, `bot-plugin`, `boot`, `bots`, `agents`, `service`, `mapper`,
`grouping` and `speaker`; `FACE_SMOKE=1 npm test` boots `desk-smoke` and `telegram-smoke`, the
canary among them ("Tests" above). What only this drill checks: a real model on the desk's
preset and contract; the real Bot API from this Mac; what the phone shows of plain text and of
an answer in parts; a real turn cut at 5 minutes, and a real `/stop`, each with a text queued
behind it; the Desk panel in a real browser over the real ledger.

**The drill**, after "Set up the bot" ("The desk"), with the service running the merged code and
the browser signed in:

1. From the phone: `hi`, then `NVDA now?`. PASS: both answered in the bot's chat; the second
   names the price with its source and time (`IEX 15:21:03 ET`, from `desk_quotes`); the
   ledger, `$DSH_HOME/face/desk/events.jsonl`, has a `desk-turn` line for each, with
   `"source":"telegram"`, `"outcome":"ended"` and four token counts.
2. `/status`. PASS: the desk line, `telegram: polling, last poll …, <n> dropped, <n> queued`,
   `desk session <id>` and `turns today <n>`, the last counting step 1's turns.
3. `/pause 1m`, then a text. PASS: `paused until HH:MM ET; a terminal resumes it: npm run desk
   -- resume`, then `paused since … by telegram until …; …` for the text, and no new `desk-turn`
   line. A minute later, a text: answered — the pause lifted itself, and the ledger has
   `off-cleared` by `expiry`.
4. `/new`. PASS: `a new desk conversation`; a `desk-session` line with `"reason":"new"`; the
   next text is answered in the new conversation, which the Desk panel lists beside the old one.
5. A long answer: ask for one past 4,000 characters — a paragraph on each of the eleven S&P 500
   sectors, say. PASS: it arrives in parts, each cut at a line end, together the whole answer.
6. A turn cut by the deadline: ask the desk to write a note one directory up,
   `../drill-note.md`. The sandbox refuses the write; when the model retries it with the
   escalation, the browser shows an approval card in the desk session — leave it unanswered.
   While it waits, the Desk panel shows `waiting` on the desk conversation, and the rail's Desk
   item a badge when another panel is open; send a second text, `and the S&P?`. PASS: about 5
   minutes after the turn began, the phone gets `timed out after 5 min; a card or a long tool was
   pending`, the card closes, the ledger has a `desk-turn` with `"outcome":"timed-out"`, and
   `desk/drill-note.md` does not exist; then the second text is answered, in a turn of its own. A
   model that does not retry with the escalation leaves this step to `telegram-smoke`; record
   which happened.
7. `/stop`: ask for something long — the eleven sectors again — then, while it is still
   working, send `and NVDA?`, then `/stop`. PASS: `stopped`; then `and NVDA?` is answered; the
   ledger's `desk-turn` for the long answer has `"outcome":"cancelled"` and `"cancel":"stopped
   from the phone"`, and any part of it the phone got ends with `(cut off: stopped from the
   phone)`. A `/stop` that lands after the long answer ended cuts the next turn instead, or finds
   `nothing is running`: try again with a longer ask.
8. From the browser, the Desk panel (`/#desk`, the rail's first item). PASS: its cards agree
   with `npm run service -- status` — the desk on, the Telegram bridge polling with its drops
   and queue, the desk conversation, today's turns and their tokens; Pause for 30 minutes writes
   `OFF` (the desk card reads paused by `page`), a phone text then gets the paused line, and
   `npm run desk -- resume` in a terminal lifts it (`resumed`); open the Pause dropdown and hold
   it across a 30 s refresh: it stays open; a desk session opens in place, the phone's texts in
   it marked ☎.

**PASS is steps 1–8.** Record the date, the commit, the desk's model route, step 5's part count
and what steps 6 and 7 met in `DEVELOPMENT.md` §7.4's P1 **Desk** row.

**Not yet run.** The automated half passes 2026-10-21; the phone, the bot and a real model are the
operator's.

### P2: the clock and the pre-close brief

PASS is P2's done criterion — a brief has arrived before the close on three sessions in a row, and
a deliberately edited `STANDING.md` was refused — and its way back, a re-arm.

**The automated half, no Telegram.** `npm test` runs `producer`, `market-clock`, `standing`,
`desk-arm`, `desk-book`, `brief`, `firing`, `schedule` and `desk-weight`, with P2's
cases in `desk`, `desk-conversation`, `desk-session`, `telegram`, `service`,
`desk-cli` and `cycle` (`market-clock` holds the calendar's cases the retired pytest held); `FACE_SMOKE=1 npm
test` boots `schedule-smoke`, the canary's firing half among it ("Tests" above). What only this
drill checks: a real model writing the brief from its block; the builtin calendar on a real session; the brief on the phone before a real close; the Desk panel over the real ledger.

**The drill**, after P1's, with the service running the merged code and the browser signed in:

1. Arm `preclose`, from `face/` in the primary checkout: `npm run desk -- arm desk --id preclose
   --at close-30m --producer builtin:brief --expires <a date past the drill>`. PASS: `armed
   preclose in <the primary checkout>: …`; within 30 s `npm run service -- status` shows `standing
   preclose: close-30m, next 15:30 ET` (12:30 ET on an early close).
2. On three sessions in a row, the brief. PASS each day: the brief reaches the phone before the
   close, its prices labelled with their feed and time; the Desk panel's Standing orders card and
   `status` show `last delivered <time>`; `$DSH_HOME/face/desk/firings.jsonl` holds the day's
   `started`, `producer`, `woke` and `finished`, and `desk/journal/briefs/<date>-preclose.md` the
   message.
3. Edit one word of `desk/STANDING.md`. PASS: at the next anchor the phone gets `preclose · <date>
   refused: desk/STANDING.md changed since arming. Review it, then: npm run desk -- rearm
   preclose`, the card shows the pin changed, and no brief comes.
4. `npm run desk -- rearm preclose`. PASS: `re-armed preclose: desk/STANDING.md sha256 <12 hex>…`;
   the next anchor runs and delivers — the same day when the re-arm lands inside the 5-minute
   grace. Undo the word afterwards and re-arm again.
5. On 2026-11-27, if it falls inside the drill: PASS, the brief arrives at 12:30 ET, before the
   13:00 ET early close.

**PASS is steps 1–4, and 5 when 2026-11-27 falls inside the drill.** Record the date, the commit,
the desk's interpreter, each day's delivery time and the brief's tokens (`firings.jsonl`'s
`finished`) in `DEVELOPMENT.md` §7.4's P2 **Desk** row — the first measured week sets
`budget.dailyTokens`.

**Not yet run.** The automated half passes 2026-11-01; the calendar, the phone and a real model
are the operator's.
