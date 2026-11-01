# gravit-ui 与现有后端的匹配度（2026-10-19）

对象：`gravit-ui/`（feat/gravit-ui @ 2418df7，spec `docs/superpowers/specs/2026-10-09-demo-v2-gravit-frontend-design.md` §1–§16）
对照：main @ f6e7ca9 的后端 —— `face/`（dsh 0.2.0-rc.2 进程内托管，`/api` Typert Remote + `/api/remote.mux` 流 + `/data/*` 路由）、
`alpaca_kit`（MCP 工具，Alpaca paper，两道闸）、`akshare-mcp`、以及作为第二候选的 `demo/`（Linqi 的 buyer-agent-demo @ 0ef5131，账户服务）。
配套：`docs/design/2026-10-13-backend-architecture.md`（主检出里的未跟踪文件）画的是后端的六扇门，本文是前端对着那六扇门的逐项核对。
交互式版本：同目录的 `2026-10-19-gravit-ui-vs-face-backend-fit.html`（81 行可按结论 / 屏幕筛选、搜索、展开证据，带路线 A 视图），也发布为私有页面 https://claude.ai/artifact/P9B7zs5DU5qrxHodGbUXio 。
方法：先手写 64 条匹配断言，再由 6 个校验 agent 逐条对着代码证伪/改正（每条带 file:line），1 个查漏 agent 独立枚举两边的面；校验改正了 21 条，补了 50 条。证据原文在本会话的 workflow 记录里（wf_85469855-78e）。

## 0. 一句话

这版前端是**按 Linqi 的账户服务画的**（spec §1.1 purpose A、§1.5 approach 2 同进程、§9 的清单全部指向 `startPortfolioServer`），
现在要它替换 main 上 face 的客户端，等于把它反过来挂到 dsh 上。对 dsh 这边：**会话、审批卡、群聊这三样核心接得上**（而且接得比原设计好——
审批卡在 dsh 上是真的，Linqi 那边是模拟的）；**行情和持仓只读能接一半**；**额度/mandate、手动下单、钱包、Memory、插件商店、邮件、电话、推送**这
八块在 face 上要么没有后端、要么直接撞宪章。替换的代价是丢掉 face 客户端的研究面（频道/策略页、过程卡片、子代理、bot 设置页、四个面板、A 股）。

## 1. 三个"后端"各是什么

| 后端 | 进程 | 给浏览器的线 | 和 gravit-ui 的关系 |
|---|---|---|---|
| face + dsh | `face/`，127.0.0.1:3090，cookie 登录 | `session/*`、`commands/execute`、`subagents/*`、`workspace/*` 等 Remote；`$events`（审批/提问）、`session/control`、`session/follow` 三种流；`/data/channels|sessions|host|memory|plugins|agents|bots|rooms|account|quotes|symbols` | 本文的主对照；face 自己的客户端是 `face/client`（33 个文件 11,148 行） |
| alpaca_kit MCP | dsh 的 MCP 子进程 | 浏览器**不直接**碰；工具结果以 `tool/call`/`tool/result` 事件进会话流 | 收据/拒绝/K 线/持仓的数据源都从这里的工具结果或 `/data/account.json` 的生产者来 |
| demo 账户服务 | `demo/src/portfolio/server.ts`，4820/4821，自己的 Host/Origin 围栏 | `/api/account/*`、`/api/order`、`/api/say`、`/api/approve`、`/api/exchange`（EIP-712 签名信封） | spec 的本意宿主；Markets/Trade/Account 三屏就是从它的页面移植的；posture C（两件产品，不接线），face/ 和 dsh/ 没有任何代码调用它 |

一个硬事实：demo 服务只答自己的页面（`server.ts:324-338` 的中间件拒绝外来 Host/Origin/跨站 Sec-Fetch-Site），所以 **face 在 3090 端的页面不能从浏览器调 4820**。"一个前端两个后端"只有两条路：把页挂进 demo 进程（spec §9.1），或 face 侧做代理（demo 的文档明确不要）。

## 2. 按屏幕打分

| 屏 | 对 face+dsh | 要点 |
|---|---|---|
| Messages（主屏） | **核心能接**；mandate 层冲突 | 会话 ↔ session；Gravit 的话 ↔ follow 流；审批卡 ↔ Gate 2 的 `approval/request`；群聊 ↔ room；Stop ↔ `session/cancel`；Change words ↔ `session/rename`。没有的：额度（每单/总额/到期/花了多少）、Beast 模式、Withdraw 的"此后不再落消息"、行预览、未读、"在哪个频道建" |
| Mail | 0 | face 没有信箱、没有地址、没有信；三封种子信（月结单、Form 4、周报）各自也没有来源（EDGAR 读的是 XBRL 和发行表，不读 Form 4） |
| Discover | 清单 ≈ 2 成，商店 0 | "我的插件"可以列 face 实际装着的：两个 MCP 服务（alpaca-kit、akshare）、接上的 CLI（claude/codex）、bots、skills；货架/安装计数/审核/公私有/Create 的 MCP 面全无。dsh 装的只有 MCP **客户端**包，当不了 MCP 服务器 |
| Markets | ≈ 6 成 | 搜索 `/data/symbols/search`、行情 `/data/quotes[/stream]`、自选本地存 —— 三样现成；缺：K 线路由（`daily_bars` 只给 Gravit 用、只有日线）、bid/ask（线上没带，两个供应商其实都有，加两个字段的事）、RWA/预测（无）、"列表第一页从哪来"（行情是按 id 拉的，没有"列市场"的路由） |
| Trade | ≈ 1 成；手动下单冲突 | face 没有任何"操作员下单"的路：下单只有 Gravit 的 `place_order`，前面两道闸。手动下单路由 = 绕过两道闸的新门，撞宪章 §1/§4。能接的只有 Hand to Gravit（变成一句 prompt → Gravit 调工具 → 卡片 → ✓） |
| Account | Portfolio ≈ 5 成；Venues 部分；Move/Receive 0；Memory 0 | `/data/account.json` 原样透传 Alpaca 的 account/positions/orders（50 条、全状态、60 s TTL）：净值、今日（equity − last_equity）、持仓、按 asset_class 的配置条、订单都算得出；没有钱包/USDC/转账/活动流。Venues 能诚实地列一行 Alpaca paper + 三个行情源的健康；Connect 没有。Memory：face 的"memory"是 skills 目录，宪章 §7.3 不建记忆层、DEVELOPMENT §10.16 推迟到下一轮 |

## 3. 十六种消息逐条

| # | 种类 | 结论 | 对应 |
|---|---|---|---|
| 1 | 你的话 | FIT | `session/prompt`（queue、requestId、content parts、时区）；群里 `@` 先走 `POST /data/rooms/say`。"每句话都是签名指令"没有对应，Sign and send 只是字面 |
| 2 | Gravit 的话 | FIT（定稿文本） | `assistant/message` → bubble。丢：pulse/思考轨迹/markdown（gravit-ui 气泡只 `esc(text)`，连 ticker 链接都只在 brief/breaking 上做）；`from:'system'` 的居中行是唯一能放 context/压缩标记的槽 |
| 3 | 待批订单 | **FIT，全表最强** | Gate 2：`$events` 的 `approval/request` → `{eventId, sessionId, toolName, callId, reason, displayReason}`；答 `mux.answer(eventId, 'allowed-once'|'rejected')`。卡上的 venue/type/amount 不必解析那行 40 字截断的 `PAPER order - …`：用 `callId` 关联 follow 流里同一次 `tool/call` 的 `data.arguments`（模型发的原始 JSON）就是精确值。"answer by" 在 Gravit 自己的会话里没有意义（卡会一直等并重放给下一个浏览器）；成员会话上的卡受房间引擎的轮次超时约束 |
| 4 | 要额度 | 形式 FIT、语义 CONFLICT | 形式 = 提问卡（见"新增两种"）；语义 = 授一个常设额度，face 没有 mandate 对象，审批结果只有 allowed-once/rejected，策略只有 ask/never，never 是直接拒单 |
| 5 | 要装插件 | GAP | 依赖 Discover |
| 6 | bot 在额度内已执行 | CONFLICT | bot 的 allow 表没有任何下单/账户工具，persona 写明不交易，成员会话钉 read-only；注意这是**配置和合约**不是围栏——真放进去了，Gate 2 是全树的，bot 下单会在它自己的成员会话上弹同一张卡 |
| 7 | 监控信号 | 推送半边 GAP；应答半边 PARTIAL | 应答（如欺诈检查）= `tool/call`+`tool/result` 一对，按工具名提升即可；推送（Telegram 监控自己发话）没有任何来源。注意现有 mapper 只认 `source.kind === 'room'`，别的 kind 的 `user/message` 会画成**你**的气泡，适配层第一天就要有 kind → 消息种类表 |
| 8 | 门的拒绝 | PARTIAL | 四种拒绝都真实存在（dsh 的 `the user rejected tool`、orders.ts 的两句、alpaca-kit 的 `{ok:false}`、TradingAPIError），都落在 `tool/result`(isError) 或 Gravit 的话里；dsh 有 `ToolErrorInfo {name, code}` 的结构槽但 face 和 alpaca-kit 都没填；`E_MANDATE_*` 是 Linqi 的词表 |
| 9 | 收据 | PARTIAL | `place_order` 的结果 = `{ok:true, …Alpaca order}`（accepted/new），**成交不推送**，之后从 `orders`/`positions` 工具或 `/data/account.json` 读；没有 ledger 编号 |
| 10 | 收尾 | PARTIAL | 会话没有 done 态；有 `turn/end`、`update_goal complete`、频道 `status.yaml` 的生命周期 |
| 11 | K 线技术分析 | PARTIAL | `daily_bars` 行有 OHLCV，蜡烛画得出（face 自己画的是收盘线不是蜡烛）；只有日线，"4h" 没来源；支撑/阻力/结论是模型散文；Gravit 的文本里没有 `{{TICKER}}` 标记 |
| 12 | 早报 | GAP | 装的 dsh 树里没有 schedule 包（有 timer 原语、jobs、goal-round-driver，都不是定时推送）；宪章"无人值守不启动"；always-on 还在想 |
| 13 | 突发横幅 | GAP | 传输都在（`$events`、follow、SSE），缺的是生产者 |
| 14 | 来电 | GAP | 没有语音线 |
| 15 | 群聊 | **FIT，次强** | 成员答 = bubble{role bot, bot, name}，轮次结束 = room-line，成员条 = `room` 投影，`@` = `/data/rooms/say`，Gravit 综合。差别：gravit-ui 在新消息时挑成员，face 按**频道**挂 bot（`POST /data/channels/bots`，上限 6），频道里的会话在第一次 `dispatch` 或 `@` 时才变成房间；成员的结构化 room-view（立场/证据/不确定性）没有界面 |
| 16 | 警报 | PARTIAL | 一句红边的 Gravit 话，宿主没有标记，只能启发式 |

合计：直接 4（1、2、3、15）· 部分 6（7、8、9、10、11、16）· 无后端 4（5、12、13、14）· 冲突 2（4、6）。
**另需新增两种**：通用审批卡（沙箱越界写也走同一条审批流，bot 的 write/bash 在 read-only 下被拒会升一级来要人批，现在会被误画成订单卡）和提问卡（`ask_user_question` 的批量问答，`{answers:[{id, selected[], custom?}]}`；dsh 还有一个 face 没开的 `timed` 模式，带 `remainingMs` 流——这是整棵树里唯一真实的"answer by"）。

## 4. 壳与传输（挂载层）

- 页面：`index.html` 的 `./css/…`、`./js/app.js` 要改成 `/client/…`（static.ts 只有 `exact /` 和 `prefix /client`），`lang="zh-CN"` 改 en，Google Fonts 保留（face 的第一个非回环资源，没有 CSP）；static.ts 不发缓存头（改完要硬刷新）；`serve.js` 去掉；`/market`、`/account` 两条页面路由变成跳转或删掉。
- 线：`face/client/api.js`（853 行，`call`/`openMux`/`randomUuid`，无 DOM，含重连、gate 重放、四种答复错误码）和 `mapper.js`（476 行，纯函数，帧 → 11 种视图）**原样复用**；`market-quotes.js`（SSE + 轮询回退 + 看门狗）也可原样复用。
- 状态：gravit-ui 把整份状态存 localStorage（`gravit-ui.state`、`gravit-ui.theme`）并视为真相；face 所有会话在宿主。改法是让 store 变成宿主状态的缓存：`initialState` 的 `accept` 是唯一的接入点；reducer 要补三样——按 `sessionId:seq` 去重、压缩检查点的区间替换、`append` 不再把宿主事件丢进本地"已关闭"的会话。
- 列表：`session/list` 的行只有 `sessionId/updatedAt/running/agentAvailable/projections`，**没有标题字段**（标题在 `projections.values.title`）、没有未读、没有预览；行预览要逐行 `session/projections`+`session/page{maxMessages:1}`（face 对子会话就这么做）或新加一条 `/data` 路由。刷新触发没有：face 在 `$events` 的 `api-session/*`、turn 帧、gate 结算之后 1.2 s 重拉列表；连接断了/401/403/503/stale 的提示面 gravit-ui 一个都没有（只有 Discover 的 toast）。
- 消息时间：每条 v4 事件都带 `time`，只是 mapper 的 FrameView 丢掉了——加一个字段的事；时间分隔线、行时间、技术分析头的时钟都靠它。
- Stop：`session/cancel` 只停当前一轮，会话还活着（goal 会被暂停，只有 `/goal resume` 能续——gravit-ui 没有斜杠命令通道）；gravit-ui 的 Stop 是终态。要选：Stop = cancel（可逆），还是 cancel + 归档（终态）。`/data/sessions/archive` 只是展示层归档；宿主侧的 `workspace/archiveSession`（归档后不再跑模型）face 按 D14 没用。
- 附件：PromptContentPart = text | image{base64} | file{receiptId}；上传走 `/api/session/uploadFileBinary` 或 `fileUploads/upload`，收据按 agent 作用域——**先有会话才能传文件**，gravit-ui 的草稿在发送前不建会话；现有 face 客户端也只发文本。麦克风两边都没有真的语音。
- 建会话："在哪建"（`session/create {workspaceId | cwd}`，都不给就是仓库根）gravit-ui 没有任何入口，所有会话都会落在默认目录，Gravit 写策略产物就没有家；一旦草稿里挑了 bot，gravit-ui 一律变成 group，即房间，而房间要先有一个挂好这些 bot 的频道——要么给一个默认频道，要么改成"按会话的名册"（face 没有这种语义）。

## 5. 与宪章或既有合约冲突的（不是补一条路由的事）

1. **额度/mandate**（新消息的额度 chip、Details 的 Change limit/End limit、kind 4、收据扣 spent）：宿主没有常设额度对象；Gate 2 一次一批；宪章"Nothing starts unattended"。要做只能作为审批策略重新设计（宪章 §4/§7 的范围）。
2. **Beast 模式**（Details 的 Mode、Account 头、rail 的 "$… · Guard" 行）：唯一能去掉卡片的开关是 approval policy `never`，而它是**拒单**不是放行；不存在 allow-always。Guard ≈ ask；Beast 没有对应。
3. **手动下单与撤单**（Trade 的 Sign and place、Markets/Account 的 Cancel）：face 没有操作员下单路；`TradingClient.place_order` 只有 paper 主机钉，没有旗标——加一条 `/data` 路由就是绕过 Gate 1（注册）和 Gate 2（卡）的新门。"Trading on · $100 a move"（被测试钉住）也没有东西可读：Gate 1 给的是开/关，没有任何每笔上限。
4. **bot 自己执行**（kind 6）：见第 3 节。
5. **钱包**（Gravit 的钱包、Top up/Take back、Move、Receive 的地址与二维码、USDC）：face 和 alpaca_kit 没有钱包、地址、转账、活动流（也不读 `/v2/account/activities`）。
6. **签名语法**（"每句话都是签名指令"、安装/发布的 For·May·May not·Until 表、工单的十分钟签名和 nonce）：face 的授权只有 `GET /?token=` 铸的 cookie 和每张卡一次 `$events/result`；没有密钥、签名载荷、地址、有效期。
7. **Memory**：宪章 §7.3 明说不建；§10.16 把 persona/memory/教学频道推到下一轮——这是"推迟的设计"，不是对抗；F13 可以作为那一轮 spec 的输入。过渡期能做的只有把 skills 目录（`/data/memory.json` + `/data/memory/skill`）当只读的"Gravit 知道什么"列表。

## 6. 替换会丢掉的 face 能力

| 丢的 | 现状 | 备注 |
|---|---|---|
| 频道 = 策略目录 | 落地页（status.yaml/THESIS/journal/backtests/文件）、新建频道、每频道的 agent 与 bot 名册、按 workspaceId 分桶 | 宪章的"一天"从"选一个频道"开始；而且 `/data/channels.json` 的 `presets` 是列表里识别 bot 家会话和房间的线索，路由本身也要留 |
| 过程面 | `tool/call`/`tool/result` 卡（market_snapshot 表、daily_bars 图、calendar、breadth/account 平铺、通用表；原始 `<pre>` 永远在）、思考轨迹、pulse、context 行、压缩、截断标记、markdown | 收据/拒绝/K 线的适配层消费的**正是**这些帧，所以"丢"的前提是没人去提升它们 |
| 临时子代理 | dock（`subagents/prompt`、`interruptByParent`、目录投影）、成员轨迹、成员条、轮次行 | gravit-ui 里没有 subagent/trace 的任何字 |
| bot 页 | 设置（名/描述/模型/SOUL/revision，409 冲突）、检查（`/data/bots/runtime`）、日志上下文 | gravit-ui 里 bot 只是 Discover 的一张卡 |
| 四个面板 | strategy / agent（模型目录、host.json、CLI 接入/断开/重扫、用量卡）/ memory（skills）/ plugin（MCP 行与工具 schema） | gravit-ui 的货架里**没有 Agents 架**（构建里是 Like·Data·Monitors·Bots·Crypto·Quant），接上的 claude/codex 没有落点 |
| 会话操作 | fork、归档/取消归档、删除、斜杠命令、别的会话有卡在等的 waiting 标、token 用量/上下文压力投影 | gravit-ui 只有重命名 |
| A 股 | 行情 `cn`（iFinD）、腾讯搜索、`mcp__akshare__*` 13 个工具 | 标签页没有位置 |
| 账户台/行情页的小字 | gate 状态块、`stale` 标、供应商状态行、轮询回退提示 | 规则 9 说不要小字；但 `/data/account.json` 60 s TTL 且出错时回旧数据，不标会把旧数当现数 |

## 7. 校验改正的、和这次才发现的 dsh 座席

- gravit-ui 的 `bot` 种类（Gravit 和一个 bot 都说话）在 face 里是**单成员房间**，不是 bot 的家会话；bot 家会话（只有 bot 一人说话）在 gravit-ui 里没有种类。
- `session/search`（全文检索，20 条 `{sessionId, snippet}`，索引消息文本、工具名和参数、工具结果）在钉住的 dsh 里存在，face 没调；是否挂了 `ctx.sessionQuery` 未证实——挂了的话"Gravit on it / 关于它的会话"就不只是标题匹配。
- 运行时挂 MCP 服务器**机械上可行**：`dsh-mcp-client` 的 `apply(ctx, config)` 是普通 cordis 插件，可以像 `declareBots` 那样作为子 fiber 挂上，工具随即注册、bot 的掩码随 `tools/change` 重展开；缺的只是一个 face 自己的持久化文件（`agents.json` 是先例）和界面。`dsh-plugin-manager`/`config-editor`/`hmr` 都装着但按 D1 不挂（需要 profileContext）。
- dsh 的工具名合约会把点号名改写：`shop.search`、`plugin.call` 这类会被规范化并加 12 位哈希后缀，spec §7.7 的工具表要改成下划线名。
- 真正实现了"一个 MCP 服务器 + 一个 manifest"的是 Linqi 的 demo（`demo/src/portfolio/mcp.ts` 和每个 venue 的 stdio 座席 `demo/manifests/*.json`）——是 venue 座席不是商店，但 manifest 的形状可以照抄。
- 订单与会话的归属（by/how/conv）：`place_order` 不设 `client_order_id`，`/data/account.json` 原样透传，订单回不到会话；唯一的链接是 Gate 2 卡（sessionId、callId）和那个会话里的 `tool/result`，客户端要在 ✓ 的时候记住。
- 行情 id 语法两边不同（`crypto:BTC` vs `crypto:BTC/USD`，`equity:AAPL` vs `us:AAPL`），线上的 crypto 只有 USD 腿；线上的人类可读消息都是中文；`cn` 的成交量永远是 null；IEX 流只覆盖 30 个美股符号，其余 60 s 轮询；每请求 100 个 id、8 个并发客户端、200 个活跃 id。
- `/data/watchlist.json` 给每个美股符号一条 30 点日收盘 spark（床到 2026-07-09 为止，15 分钟 TTL），`/data/market.json` 有 breadth/tape/两个筛选的行——都没有页面在读；要做 Stocks 概览或"因子筛选"插件的输出，它们是现成的生产者。
- 校验发现的 face 真实对应物，Discover 的目录条目其实有一半已在跑：Quant 架的 Backtest/Factor screen ↔ `role_backtester`/`screen`，Monitors 的 Earnings calendar ↔ `earnings`/`calendar`，Data 的 Price feed ↔ 行情线，News sentiment ↔ `web_search`，Memory 的 Style/Rules ↔ `dsh/skills/style-gravit`。"我的插件"可以如实列出这些。

## 8. 代码量

| | 行 |
|---|---|
| face/client | 11,148（JS 9,010 + CSS 1,981 + HTML 157；chat.js 4,461、chat.css 1,640、api.js 853、mapper.js 476、render.js 351、market*.js 1,034、account*.js 448） |
| gravit-ui | JS 3,432 + CSS 715 = 4,147；测试 3,938 行，全部跑在假 DOM 上，**不碰线** |
| face/tests | 71 个文件 17,059 行，覆盖线、闸、房间；新客户端一行都继承不到 |

## 9. 两条路线

**路线 A — gravit-ui 做 face 的新客户端。** 留下接得上的：壳、Messages（文本 + 审批卡 + 提问卡 + 房间）、Markets（搜索/行情/自选 + 一条新的 bars 路由）、Account 的 Portfolio（只读）+ Venues（Alpaca + 行情源）+ Settings，Discover 退化成"我的插件"清单。按宪章拿掉或改口径：额度 chip、Beast、Trade 的手动下单与 Cancel（只留 Hand to Gravit）、钱包/Move/Receive、Mail、电话、早报/横幅/监控、Memory（等 §10.16）。补回必须的研究面：至少"在哪个频道建"的选择、频道落地页的入口、过程卡的折叠视图、fork/归档/删除、斜杠命令。
代价：一层适配（帧 → 16 种 + 2 种新卡的表、宿主状态缓存、列表刷新、错误面、时间字段、订单归属）、static 挂载、bars 和 unread 两条小路由、bid/ask 两个字段；再加上把 face 客户端里纯函数模块挪过来。CSS 基本不动。

**路线 B — 按 spec 原意挂到 demo 的账户服务。** Markets/Trade/Account 三屏几乎 1:1（`/api/account/explore|asset|candles|market|compare|quotes|holdings|statement|receive`，`/api/order`，`/api/say`、`/api/approve`），连词汇都对得上（持仓键、CAP_USD = `--live-cap` 默认 100、QUOTE_MS = MONEY_TTL_MS 十分钟、What you sign 的字段就是 liveOrder 的形状；两处不同：mode 在线上叫 guard|open，IBKR 接不了）。但要补客户端的 prepare → 签名 → `/api/exchange`（配对码、P-256 设备钥、nonce 信封）——gravit-ui 现在"按一下就当签了"；而且 demo **默认真钱**（`real: true`，每单/每次转账 100 美元上限）。Messages 侧 §9.2–§9.6（每任务日志、signed say、商店 MCP 面、Memory、定时推送）在 demo 里同样没有。这条路 face 不动，两件产品继续各自是各自。

**不可行的：** 一个前端同时接两个后端。demo 的围栏不答外来页面；要真这么做就是把 2026-10-05 记录的五个冲突（gate、signer、network、card-per-write、ledger，`docs/superpowers/plans/2026-10-05-venue-plugins-unification-handoff.md` §12.1）拿出来一个个决定。

**建议：** 既然目标是替换 main 的前端，就是路线 A，分三期——(1) 壳 + Messages + 两张卡 + 房间（这一期就能把现有客户端替掉大半，且审批卡比原设计更真）；(2) Markets + Account 只读；(3) Discover 清单 + 频道入口。Trade/额度/Beast/钱包/Mail/电话在界面上先去掉，不留假门。先写 spec：这一步改动的是宪章层面的产品边界（什么面给操作员、什么门不开），不是实现细节。
