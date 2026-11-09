# Gravit

A personal agent that grows with your investing experience — and connects to a wider world of agents.

Today Gravit is a research and paper-trading companion for investors and traders, on US equities and A-shares. A persona that grows with the user, and an interface by which Gravit discovers and calls other agents, are stated product direction, not shipped features. Gravit is the product name.

## Today, tomorrow, and further out

**Today — a research and trading partner.** One operator, one machine. The principal agent runs on DeepSeek Harness (dsh) inside the chat face and works three layers: the market, the Account, and strategies. It reads US equities and A-shares, keeps a thesis and a journal, and places forward paper trades on paper venues the operator granted. The operator reviews the work and keeps final judgment. Away from the screen, the desk reaches the operator's phone with what the operator armed: standing orders, the watch, and a strategy's pre-market report. A desk turn informs. The desk preset has no shell and no order tools.

**Tomorrow — a persona that understands you and grows with you.** Planned, not built. An agent with its own name and character, that speaks up on its own and grows as the user's investing experience changes. Proactive contact would build on the desk that already phones, watches, and reports. A dedicated memory module is part of this direction and is not yet designed. User-preference modelling, personality formation, and autonomous growth are planned. None of them runs today. The research prompt the agent runs with now (`dsh/profile/persona.md`) is not this persona. Git history, strategy directories, bot journals, and session histories are a persistent record of decisions and interactions. They are not that module.

**Further out — an open, connected agent.** Planned, not built. Gravit holds an external identity and, outbound only, discovers and calls other agents. No such interface exists, and no agent network exists here. Inbound calls from other agents are out of scope.

## How trust is earned

Auditability, forward paper trading, and the operator's final judgment are how Gravit earns trust and forms a shared judgment with the user. They are the present discipline of the research and trading partner, not the definition of the product.

## How it works today

**MARKET** is the market service in `market/` (`127.0.0.1:4821`). It serves keyless public reads, including US shares and A shares (China, via Tencent), an AKShare sidecar for A-share data, the Lunhui relay, and iFinD. It holds no wallet and writes nothing. The agent reads it through `mcp__market__*` (`market_explore`, `market_quotes`, `market_candles`, `market_book`, `market_akshare`). Those reads are live. Since 2026-10-24 the tree has no lookahead guard: a number read today is today's.

**ACCOUNT** is the wallet service in `account/` (`127.0.0.1:4820`), the operator's Account. It serves no page of its own. The agent reaches it through a seat (`mcp__account__*`) on paper venues only. Every seat write stops for a card in the face (Gate 2) and again for the Account's own card. The operator uses the same Account by hand from the face's Trade screen, each act signed with the browser's device key under the Account's cap. A real venue the operator connects and trades by hand is the operator's own act. A strategy's evidence is the forward paper trade.

**STRATEGY** is `strategies/`: one directory per strategy, and the agent's arena. In the face each directory is a channel.

A strategy directory carries:

- `status.yaml` — the lifecycle `idea | researching | validated | paper | retired`. `paper` means a forward paper trade is running on the Account.
- `THESIS.md` — the thesis, with a Falsification section (metric, threshold, and window).
- `journal.md` — the evidence journal. A paper-trade entry records the Account's own figures as returned, with the order ids.

Git log is the audit trail of those decisions. Iterations between cycles are committed as they are made. A cycle commits once, with its verdict, or the operator makes that commit. That record is not a memory module.

On 2026-10-24 the operator removed the point-in-time beds, the replay channel, and the lookahead guard. Evidence is a forward paper trade placed after the thesis and its falsification terms are written, with fills and the statement recorded by the Account as time passes.

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
| `docs/` | frozen research inputs, the face's design prototypes, and the dsh upgrade guide |

The project's design documents (the charter, the as-built reference, the roadmap, and the specs and plans) are kept private and are not part of this repository. Here, depth lives in `face/README.md` (the face's contracts) and the code's docstrings. On a question of mechanism, the code is the fact.

## License

A license for this repository has not been chosen. A `LICENSE` file will be added when it is.

## 中文

与你的投资经验共同成长的个人代理，连接更广阔的代理世界。

今天的 Gravit 是面向投资者和交易者的研究与纸面交易伙伴（美股与 A 股）。随使用者成长的人格，以及对外发现并调用其他代理的接口，是产品方向，尚未交付。Gravit 是产品名。

今天是研究与交易的伙伴：一个操作者、一台机器，操作者保留最终判断。明天（计划，未实现）是能理解使用者并与之共同成长的人格：有自己的名字和性格，会主动开口，主动联系建立在已有的桌面电话、盯盘和盘前报告上。专门的记忆模块在计划中，尚未设计。用户偏好建模、性格形成和自主成长都未实现。更远（计划，未实现）是开放、相连的代理：Gravit 持有对外身份，只出站去发现并调用别的代理。入站不在范围内。没有这样的接口，也没有代理网络。

可审计的研究、向前的纸面交易和操作者的最终判断，是 Gravit 取得信任、与使用者形成共同判断的方式，不是产品的定义。git 历史、策略目录、bot journal 和会话历史是决策与交互的持久记录，不是记忆模块。

今天的机制：`market/` 提供公开行情（含美股与 A 股，A 股经腾讯与 AKShare）；`account/` 是操作者的账户，席位只在纸面 venue 上下单，每一笔写都要过门禁卡和账户自己的卡；`strategies/<name>/` 是一条策略。`status.yaml` 的状态为 `idea | researching | validated | paper | retired`。`THESIS.md` 写证伪标准（指标、阈值、窗口）。`journal.md` 记证据，纸面交易记下账户返回的数字和订单号。一个研究周期以一次提交留下审计轨迹，或由操作者提交。2026-10-24 起，点时数据床、回放通道和前视防护已从树中移除，证据来自向前的纸面交易。桌面侧包括电话（Telegram 或 Slack）、按交易所日历触发的常设指令、美股与 A 股的盯盘，以及每条策略的盘前报告。桌面回合只通知操作者；该预设没有 shell，也没有下单工具，写入只留在 `desk/journal/`。界面在 Settings › Language 中在 English 与 中文之间切换界面文字。
