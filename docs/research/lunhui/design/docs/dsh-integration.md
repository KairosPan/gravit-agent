<!-- copied byte-identical from evolving-alpha codex/lunhui-agent-design @ 2ae4df0, 2026-10-19 -->
# DeepSeek Harness 接入设计

本设计将官方 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 作为交易研究运行时：它组织模型、工具、角色和会话；独立领域服务维护时点数据、交易意图、风控、资金与订单。本文主体定义完整交易系统的目标接口和实施验收条件。

2026-10-12 实施更新：已安装并锁定 npm `@deepseek-ai/dsh@0.2.0-rc.2`，创建可运行的最小研究 profile，通过官方 headless launcher 和真实腾讯行情完成 DeepSeek Flash 调用。实际代码与权限见 [Harness 适配器](../frontend/harness/README.md)，启动、凭据和验证见 [工作台说明](../frontend/README.md)。本阶段只实现单个只读研究 agent、三个工具和本地报告；以下多角色、领域账本、订单与生产隔离仍是目标设计。

核查日期为 2026-10-01。上游处于 developer preview；下列能力以链接中的官方主分支文档为依据。本文中的 `lunhui-*` 名称均为拟建业务插件或工具，不是已发布包。

## 1. 装配方式与实际扩展点

官方 dsh 基于 Cordis，模型适配器、工具、Session 和 agent loop 均由插件组成。应用通过 `dsh` 的命名 profile 启动；bundle、profile patch、home patch 和调用级 patch 按顺序参与装配。因此轮回业务作为独立 bundle 接入公开接口，不修改 agent loop，也不另建绕过官方 launcher 的生产入口。[官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)

首版拟建研究 profile 和业务 bundle，使用 headless 的单次执行语义。具体包版本、配置行 ID 和 patch 格式在版本锁定后生成；本设计不提供未经启动验证的 YAML。领域服务初期可以是一个 TypeScript 进程，dsh worker 与它分进程通信，与[系统设计](system-design.md)一致。

| 目标 | 接入接口 | 轮回的使用方式 |
|---|---|---|
| 创建与恢复研究任务 | `ctx.agents.create/resume` | 为受控任务持有生命周期 handle；不把订单所有权放进 Agent |
| 提交任务或上下文 | `Agent.followup/steer/inject` | 普通研究任务用 followup；inject 仅传下一步上下文，不假定它会唤醒空闲 agent |
| 增加模型能力 | `ctx.tools.register`、`defineTool` | 数据查询、规则检索、分析工件和意图提交通通有参数及输出契约 |
| 角色装配 | `dsh-agent-preset-registry`、`dsh-agent-preset` | 分配研究角色的工具和提示词；只允许部署时审核过的定义 |
| 调用前策略 | `tools/pre-execute`、`ctx.tools.guard()` | 前者处理可组合策略；后者拒绝不可越过的同步约束 |
| 截止时间与观测 | `tools/execute`、`tools/result` | 包裹取消与超时；观察最终工具结果并关联领域记录 |
| 研究轨迹 | Session、`session/event`、持久化服务 | 保留输入、模型与工具轨迹；领域账本独立保存业务事实 |

生命周期和消息行为依据 [Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent/README.md)；工具作者接口依据 [Tool authoring](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)。`whenIdle()` 只表示整个 agent 暂时无活动，不能替代某个 `decision_id` 的成功回执。

Preset 当前采用 YAML 声明插件，已运行 Agent 保留它绑定的 revision，重启则依据当前同 ID 定义恢复。部署必须记录实际 preset 内容哈希，不能仅记一个名称。Preset 提供能力组织，不提供安全沙箱。[Preset registry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/README.md)

## 2. 业务插件与工具权限

以下是本项目拟建接口。所有调用都由可信运行时绑定角色、任务、账户别名、证券集合及 `snapshot_id`；模型传入的字符串不能自行扩大这些权限。账户身份由领域服务验证 worker 凭证后解析，不接受模型自行指定任意真实账户。

| 拟建插件 | 模型可见工具 | 允许读取 | 允许写入 | 角色 |
|---|---|---|---|---|
| `lunhui-market-evidence` | `market_snapshot_get`、`evidence_get` | 已授权快照、到该时点已公开的公告和行情证据 | 无 | 全部研究角色 |
| `lunhui-feature-query` | `feature_query` | 已计算的广度、题材、个股与预期特征 | 无；不接受任意 SQL 或表达式执行 | 市场、个股、反证、协调者 |
| `lunhui-playbook` | `playbook_get` | 《轮回》段落映射、冻结策略版本、适用与失效条件 | 无 | 全部研究角色 |
| `lunhui-account-view` | `account_summary_get` | 脱敏仓位、可用资金摘要、在途风险 | 无 | 主协调者；反证角色只读必要风险摘要 |
| `lunhui-analysis-artifacts` | `analysis_submit`、`analysis_get` | 同任务的受控分析工件 | 追加本角色分析与证据引用；不能覆盖他人或过去版本 | 三个研究角色、主协调者 |
| `lunhui-intent-proposals` | `decision_submit`、`decision_status_get` | 本任务意图与领域处理状态 | 追加待审核意图；不能生成风险许可或订单 | 仅主协调者 |
| `lunhui-review` | `review_case_get`、`review_record` | 已封存的决策、订单与对照结果 | 追加归因与待评审实验建议 | 盘后复盘任务 |
| `lunhui-tool-policy` | 无 | 运行时授权、冻结配置、角色工具白名单 | 本地策略决策与审计记录 | 部署组件 |

`decision_submit` 接受 WAIT、WATCH、PROPOSE、REDUCE、EXIT 等领域意图；REDUCE/EXIT 仍是提案，不能等同于已卖出。首版不向模型注册券商下单、撤单、资金划转、风控配置修改、插件管理或通用 shell 工具。订单回报、确定性退出规则与应急处理由交易内核继续执行，不等待模型。

所有工具返回结构化状态、`as_of`、`snapshot_id`、数据版本及证据引用。查询范围和结果大小有上限，缺数、过期、截断与来源冲突必须显式返回。新闻、公告和文档内容作为证据字段传入，不能修改系统提示词、工具白名单或授权配置。

`defineTool` 可校验结构，但非空、数值范围、跨字段关系、证据可见时间与任务归属仍需业务代码检查。工具正确响应 `exec.signal`；超时结束等待不代表外部写入已被撤销，因此写入操作必须返回可查询的领域回执。[工具契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)

本设计的 JSON Schema 2020-12 是领域服务的校验契约。实现时将模型可见字段映射到锁定 dsh 版本支持的工具 DSL；不假定 `allOf`、格式检查或全部条件 schema 可直接传入 provider。领域服务仍执行完整 schema 与跨对象不变量验证，工具界面只承担第一层检查。

## 3. 风控边界与隔离

工具流水线先经过 `tools/pre-execute`，再经过单调拒绝的 `ctx.tools.guard()`，然后才进入执行；`tools/post-execute` 已晚于工具主体，不可用它阻止已发生的副作用。工具定义的 `timeoutMs` 也不自动产生执行期限，实施时必须装配超时策略并验证取消传递。[Tools](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/README.md)、[执行流水线](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md)

本项目在 guard 中检查角色、工具名称、任务有效性和冻结配置身份等同步不变量。最新资金、持仓、证券状态、价格与剩余额度由独立领域服务重新读取，并在风险许可与资金预占事务中检查。模型意见、审批 UI 或其他插件都不能放宽这些条件。

| 运行区域 | 凭证与网络 | 文件和配置权限 |
|---|---|---|
| dsh 研究 worker | 仅模型 API 和受限领域查询/提案接口；没有券商密钥 | 固定只读插件与策略；仅写会话和临时分析目录 |
| 交易领域服务 | 行情、数据库及模拟交易适配器；未来实盘凭证仅在执行边界保管 | 维护账本、风险配置版本、资金预占和订单事实 |
| 离线评测环境 | 固定历史数据和受控实验输入；无生产下单通路 | 独立实验工件目录；产出候选版本，不能发布 |

Host 插件在进程内执行，位于 workspace sandbox 外，因此工具白名单不是恶意插件的隔离墙。worker 必须由操作系统和网络策略限制出口及凭证，插件包只能由部署流程审核安装；生产关闭模型可调用的 `plugin_manager`，也不依赖 deny 某条 shell 字符串来隔离券商权限。[Plugin manager](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/plugin-manager/README.md)

默认 shipped profile 可能携带编码工具或机器级 patch。上线前必须检查最终装配结果和每个角色实际可见的工具全集；新增工具默认拒绝，角色局部注册同样接受硬策略约束。模拟和未来实盘使用不同凭证、数据命名空间与部署环境，不能靠 prompt 中的“模拟”字样切换。

## 4. 数据外发与模型接入

研究 worker 向模型发送最小必要的时点摘要、候选证据、脱敏账户风险及工具 schema。订单原始账本、真实账号、密钥、数据库连接串和认证头不进入消息或工具结果。工具失败返回稳定错误码与受控描述，不返回凭证或未经筛选的服务异常。

上游 `dsh-session-log-deepseek` 默认开启额外 Session 日志上传，位于模型输入字段之外。本项目部署要求显式关闭其 `enabled`；重新开启可能补传关闭期间尚未接受的事件，因此生产配置不得由研究 agent 修改。[Session log upload](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-log-deepseek/README.md)

`dsh-plugin-package-inventory-deepseek` 同样默认发送活动包名称和版本。本项目也显式关闭该贡献，并在网络请求验证中确认两个扩展字段均不存在。关闭这些扩展只减少额外元数据，正常模型调用仍会发送 messages；其他遥测和反馈配置需要单独核对，不能据此宣称完全无外发。[Package inventory](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/plugin-package-inventory-deepseek/README.md)

当前官方认证插件为 `@deepseek-ai/dsh-llm-deepseek-api-key`，route 为 `deepseek-official`，使用 `DEEPSEEK_API_KEY` 凭证引用；官方 transport 当前采用 Messages 格式。模型初选 `deepseek-flash`，复杂反证是否使用 `deepseek-v4-pro` 由延迟、成本和评测决定，不把更大模型视作风控替代。[API-key provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek-api-key/README.md)、[模型目录](https://api-docs.deepseek.com/quick_start/pricing/)

Reasoning 与工具历史的回传交给官方 adapter。业务摘要不得擅自破坏 replay metadata；工具 schema、模型目录声明和 API 的 strict 模式也不等于领域正确性保证。本项目依赖本地契约校验，不假定未验证的 strict 或强制工具选择已被 Harness 映射。[DeepSeek adapter](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-deepseek/README.md)

## 5. 外部调度、单次分析与恢复

首版由独立事件协调器依据 `Asia/Shanghai` 交易日历和市场事件启动 headless 研究任务。协调器维护任务去重、每账户决策修订锁、截止时间和资源预算；不通过高频自然语言提醒模拟行情循环。

1. 领域服务冻结 `snapshot_id`、策略版本、候选证券、已登记预期和允许读取的证据；创建带 `event_id` 的任务。
2. 协调器取得账户的有效决策修订，启动固定 profile 的 dsh worker。并行研究子任务共享同一快照。
3. 子任务追加分析工件；协调者提交意图。服务端根据可信任务身份分配或校验幂等键，对相同请求返回同一回执，对同键不同内容拒绝。
4. 意图与领域事件在同一数据库事务中落库，由 outbox 驱动后续确定性策略校验和风险处理。worker 返回的自然语言不是执行指令。
5. 协调器同时检查领域回执、进程退出码、turn 结束原因和期限。缺少有效意图时记录 WAIT 或任务失败，不能从零散输出猜测买卖。
6. 崩溃或超时后先查询任务和意图记录。需要重新研究时创建新尝试并重新验证快照时效，不重播历史写工具或不明订单。

Headless 每次运行一个任务后退出，支持 JSON 事件输出和恢复已存在 Session；部分事件字段可能截断，且收到 final 事件不保证成功。因此展示流只用于进度和诊断，完整决策来自领域存储。[Headless](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)

官方 Schedule 当前是可选实验性 Web Host 功能，依赖 Session controller 和持久化服务，不能直接作为 headless/SDK-only 定时器。其分钟级提醒只确认 inbox 入队，崩溃可能重复交付。未来启用 Web 工作台时可用于盘前提醒、盘后报告；首版交易事件与任务完成判定全部由外部协调器负责。[Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/schedule/schedule/README.md)

DSH Session 保留研究轨迹。日志 append 与抗崩溃持久化不同，只有成功 flush 才构成持久化屏障；恢复未完成 turn 不能证明外部副作用是否发生。领域意图、资金预占和订单各有自己的 durable ledger、幂等标识和对账状态，不能以 Session 日志替代。[Persistence](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md)

## 6. 版本固定与发布记录

最初设计时读取的上游主分支根 manifest 标记 `0.2.0-rc.2`，不能单凭它证明 npm 发布状态。现已在 `frontend/package.json` 固定实际 npm 版本，并提交包含制品完整性信息的 lockfile；适配器在启动前核对包名与版本。本文主分支链接仍仅用于阅读参考，不是可复现依赖。[上游 manifest](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)

实施第一阶段必须形成发布清单：

- 官方仓库 commit SHA、所选 npm 包确切版本、lockfile 和制品完整性摘要。
- Node 与包管理器版本、平台、实际装配配置及 profile/preset/bundle 哈希。
- 业务工具 schema、策略、规则、提示词和领域协议版本。
- 请求的模型名、推理配置与提供方可得的响应模型标识；无法获得不可变模型版本时明确记录该限制。
- 数据快照、模型调用预算、外发配置及验收证据。

任何插件、模型路由、schema 或策略升级都在独立候选环境验证后发布。模型服务的别名和服务端行为可能变化，即使 Harness 版本固定也不能承诺完全相同的生成结果；评测应保留原始响应并允许重放已记录决策。

## 7. 实施验收条件

以下是完整交易系统运行时接入的生产验收条件，尚未全部执行。当前只读入口的已执行测试另列于工作台说明；具体策略和订单测试见[风控与验证](risk-and-evaluation.md)。

| 验证 | 必须观察到的结果 |
|---|---|
| 真实装配启动 | 使用锁定制品、隔离配置目录和官方 launcher 启动成功；工具、adapter、持久化均实际加载 |
| 角色权限 | 每个角色的实际 schema 集与白名单一致；子任务、局部注册、工具组合调用也无法提交越权意图 |
| 硬拒绝顺序 | guard 拒绝后工具主体调用次数为零；其他 listener 或模型再请求不能放行 |
| 数据时点 | 不同 snapshot、晚到公告、过期结果与越界证券查询被拒绝或明确缺数，不合并成当前证据 |
| 契约与取消 | 空内容、无效字段、越界数值、超时和取消有可观测结果；迟到输出不能覆盖新修订 |
| 写入幂等 | 重复事件、重复工具请求、worker 重启只产生一个有效意图；同键不同内容返回冲突 |
| 故障窗口 | 在意图落库前后、outbox 交付前后和进程终止时注入故障，均能查询并恢复，不盲重播写调用 |
| 外发边界 | 受控 HTTP 观测确认无两个额外元数据字段，无真实账号或密钥；模型消息仅含允许的摘要 |
| 进程隔离 | worker 无法读取执行凭证、连接券商出口或修改发布配置；订单管理在 worker 退出后继续运行 |
| 模型兼容 | 授权后的真实小额调用验证 thinking、多轮工具历史、schema 错误、流结束及 rate-limit 处理；失败不会产生新订单 |
| 运行预算 | 合成与回放任务符合候选数、工具数、重试数和总期限；资源耗尽退回 WAIT，不阻塞对账 |
| 升级恢复 | 新旧 preset/工具版本有明确拒绝或迁移行为；无法忠实恢复的旧 Session 不被静默当作新上下文 |

以上条件齐全才能称为完整交易运行时通过生产验收。当前已实际接入官方 Harness 的单轮只读研究入口和真实行情，不代表多角色交易系统完成，也没有实盘或回测收益结论。
