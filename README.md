# Gravit

Gravit is a workbench for self-evolving trading research on US equities and A-shares, built on auditable research, forward paper trading, and the operator keeping final judgment.

It is one operator, one machine, and one principal agent (Gravit), running on DeepSeek Harness (dsh) inside the operator's chat face. The agent organizes the work, checks the evidence it gets back, and writes the research conclusion. The operator reviews the diff and keeps the last word.

## What it does

Three layers.

**MARKET** is the market service in `market/` (`127.0.0.1:4821`). It serves keyless public reads, including US shares and A shares (China, via Tencent), an AKShare sidecar for A-share data, the Lunhui relay, and iFinD. It holds no wallet and writes nothing. Gravit reads it through `mcp__market__*` (`market_explore`, `market_quotes`, `market_candles`, `market_book`, `market_akshare`). Those reads are live. Since 2026-10-24 the tree has no lookahead guard: a number read today is today's.

**ACCOUNT** is the wallet service in `account/` (`127.0.0.1:4820`), the operator's Account. It serves no page of its own. Gravit reaches it through a seat (`mcp__account__*`) on paper venues only. Every seat write stops for a card in the face (Gate 2) and again for the Account's own card. The operator uses the same Account by hand from the face's Trade screen, each act signed with the browser's device key under the Account's cap. A real venue the operator connects and trades by hand is the operator's own act. A strategy's evidence is the forward paper trade.

**STRATEGY** is `strategies/`: one directory per strategy, and Gravit's arena. In the face each directory is a channel.

A strategy directory carries:

- `status.yaml` — the lifecycle `idea | researching | validated | paper | retired`. `paper` means a forward paper trade is running on the Account.
- `THESIS.md` — the thesis, with a Falsification section (metric, threshold, and window).
- `journal.md` — the evidence journal. A paper-trade entry records the Account's own figures as returned, with the order ids.

Git log is the audit trail. Iterations between cycles are committed as they are made. A cycle commits once, with its verdict, or the operator makes that commit.

On 2026-10-24 the operator removed the point-in-time beds, the replay channel, and the lookahead guard (`DEVELOPMENT.md` §2). Evidence is a forward paper trade placed after the thesis and its falsification terms are written, with fills and the statement recorded by the Account as time passes.

The desk is the face's always-on side.

- **Phone.** A private Telegram chat or a Slack DM. The Account holds the network tokens and the inbox; the face polls the Account and sends through it.
- **Clock.** Standing orders the operator arms from a terminal, fired on each order's market calendar (XNYS, or the XSHG table for A shares). The pre-close brief is one of them.
- **Watch.** US shares and A shares named in the operator's book, levels, and rules, priced from the market's reads, with alerts sent to the phone. US filing rules cover new 8-K, 8-K/A, and Form 4 filings from SEC.
- **Per-strategy pre-market reports.** `builtin:report` sends a strategy's screen line, its `status.yaml`, and its levels against one market snapshot.

A desk turn informs the operator. The desk preset has no shell and no order tools; its writes stay in `desk/journal/`.

The face is one page (`Messages`, `Markets`, `Trade`, `Discover`, `Account`). Settings › Language switches every word the face itself writes between English and 中文 (`face/client/js/i18n/en.js` and `zh.js`).

<!-- Screenshots: real UI captures to be added before the public launch. -->

## Quick start

Node `^22.19.0` or `>=24.0.0` (`face/package.json` `engines`).

```bash
cd face
npm install
npm run setup    # creates $DSH_HOME/profiles/face; never overwrites an existing profile
npm start        # prints http://127.0.0.1:3090/?token=…
```

Open the URL `npm start` prints, the one carrying `?token=`. That visit sets a 30-day cookie for that exact host and port (`localhost` is not `127.0.0.1`). `/api` answers 401 until then. `FACE_PORT` defaults to `3090`. `0` asks the operating system for a free port.

The model credential is `DEEPSEEK_API_KEY`. Source `../.env.deepseek`, or put the same name in `$DSH_HOME/.env` (dsh's credential store can hold it too). The face boots without it; the first prompt fails until it is set. When `$DSH_HOME/.env` does not exist yet, `npm run service -- install` writes one from the repo's key files and copies an allow-list only. The names on that list include `DEEPSEEK_API_KEY`, `APCA_API_KEY_ID`, and `APCA_API_SECRET_KEY`. No key value belongs in the repo.

On macOS the same checkout can run as a user LaunchAgent. It starts at login and starts again after any exit but a clean one. It needs no administrator. `install` refuses a home with no `profiles/face`, so run `npm run setup` first. The launchd commands refuse off macOS.

```bash
cd face
npm run service -- install
npm run service -- url     # the sign-in URL (?token=) from the face's log
```

Markets, the seat, and the desk's prices also need the other two processes. Each is its own package:

```bash
cd market && npm ci && npm run market     # 127.0.0.1:4821
cd account && npm ci && npm run account   # 127.0.0.1:4820
```

## Repo layout

| Path | What |
|---|---|
| `face/` | the chat face: hosts dsh in-process and serves the page at `127.0.0.1:3090` |
| `account/` | the Account service and the seat Gravit uses |
| `market/` | the market service: keyless public reads, A shares, AKShare |
| `desk/` | the pre-close brief's standing order, the watch rules, and the desk journal |
| `strategies/` | one directory per strategy (`_template` is the copy source) |
| `bots/` | operator-authored bot voices |
| `roles/` | one-shot roles Gravit can call |
| `dsh/` | the harness profile template, the research-cycle contract, and the skill packs |
| `docs/` | specs, plans, runbooks, and frozen research inputs |

Depth lives in `Gravit-Design.md` (intent), `DEVELOPMENT.md` (mechanism), and `face/README.md` (the face's contracts). On a question of mechanism, the code is the fact.

## License

A license for this repository has not been chosen. A `LICENSE` file will be added when it is.

## 中文

Gravit 是面向美股与 A 股的自演进交易研究工作台，写在可审计的研究、向前的纸面交易上，最终判断留给操作者。

三层：`market/` 提供公开行情（含美股与 A 股，A 股经腾讯与 AKShare），`account/` 是操作者的账户，Gravit 只在纸面 venue 上经席位下单，且每一笔写都要过两张卡；`strategies/<name>/` 是一条策略。`status.yaml` 的状态为 `idea | researching | validated | paper | retired`。`THESIS.md` 写证伪标准（指标、阈值、窗口）。`journal.md` 记证据，纸面交易记下账户返回的数字和订单号。一个研究周期以一次提交作为审计轨迹，或由操作者提交。2026-10-24 起，点时数据床、回放通道和前视防护已从树中移除，证据只来自向前的纸面交易。

桌面侧在操作者离开屏幕时仍在：电话（Telegram 或 Slack）、按交易所日历触发的常设指令、美股与 A 股的盯盘，以及每条策略的盘前报告。桌面回合只通知操作者；该预设没有 shell，也没有下单工具，写入只留在 `desk/journal/`。界面在 Settings › Language 中在 English 与 中文之间切换界面文字。
