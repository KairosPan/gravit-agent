<!-- copied byte-identical from evolving-alpha codex/lunhui-agent-design @ 2ae4df0, 2026-10-19 -->
# 来源与假设

本设计只使用用户提供的《轮回.docx》和外部官方资料，没有读取或沿用原项目业务代码与旧设计。研究日期为 2026-10-01（用户所在 America/New_York 日期）。外部网页可能继续变化；实施前必须固定依赖和规则版本。

## 1. 用户资料

[原始文档](../references/lunhui/轮回.docx)的 SHA-256 为：

```text
8afc44a3163f706188db4aea5fa688aa40a13f06c30b19471c6e0a14d37b74d6
```

已提取 1,206 个非空正文段落、约 30,092 个正文字符，文档内有 37 个媒体文件。`Pxxxx` 以 `word/document.xml` 中正文段落的顺序编号，包括表格内段落；空段落仍占编号，因此编号不连续。设计引用可在 [paragraphs.json](../references/lunhui/paragraphs.json) 和 [extracted.txt](../references/lunhui/extracted.txt) 检索。

[tables.json](../references/lunhui/tables.json)保留表格行列与段落的对应关系，避免纯文本展平后把相邻策略的条件误拼在一起。[manifest.json](../references/lunhui/manifest.json)记录原件及媒体哈希，[image-anchors.tsv](../references/lunhui/image-anchors.tsv)记录可解析的内嵌图片段落锚点。

原件已尝试渲染并检查缩略页面；渲染环境存在中文字体缺字，因此正文内容以 OOXML 提取及表格关系为准，不能用渲染页码充当可靠定位。另行检查了可解码的 36 张原始图片：包含周期示意、K 线/分时案例、梯队及形态示意；未把截图像素逆推出精确交易数据。未解码的剩余媒体不作为新增规则来源，完整原件仍保留。

有两项图片文字补充值得保留：P0392 的图示将指数与板块同时出现超跌作为研究背景；P0964 的图示将人气/高度、板块助攻、抛压与成交量合并判断买点。它们支持多条件确认的设计，但不构成胜率证据。P0059 的周期示意包含反弹后继续下跌与新周期两种路径，故状态机不强制从冰点进入上涨。

## 2. DeepSeek 官方依据

| 资料 | 用途 |
|---|---|
| [用户指定的 Harness 官网](https://www.deepseek.com/en/harness/) | 确认目标产品和插件化方向 |
| [官方仓库](https://github.com/deepseek-ai/deepseek-harness)及[架构](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) | profile、bundle、运行模式与核心边界 |
| [工具作者指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md)及[工具流水线](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md) | typed tools、调用前策略和副作用边界 |
| [角色 registry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset-registry/README.md) | 声明式角色、版本与能力装配 |
| [Headless](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/headless/README.md)及[Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/schedule/schedule/README.md) | 单次任务与提醒调度的能力差异 |
| [持久化](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/persistence.md) | 研究轨迹与交易账本分离 |
| [Session log 上传](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-log-deepseek/README.md) | 部署时显式控制额外日志外发 |

接口细节和完整近旁引用见 [dsh 接入设计](dsh-integration.md)。本设计尚未固定上游不可变 commit，也未运行 dsh；主分支文档核查不能代替实际集成验证。

## 3. 交易规则依据

采用交易所和监管官方材料，具体条款映射见 [风控与验证](risk-and-evaluation.md)。

- [上交所 2026 规则修订发布说明](https://www.sse.com.cn/aboutus/mediacenter/hotandd/c/c_20260424_10816474.shtml)。
- [深交所 2026 交易规则原文](https://docs.static.szse.cn/www/lawrules/rule/trade/current/W020260424690713155663.pdf)。
- [证监会程序化交易管理规定发布说明](https://www.csrc.gov.cn/csrc/c100028/c7480577/content.shtml)。
- [上交所程序化交易实施细则](https://www.sse.com.cn/lawandrules/sselawsrules2025/trade/universal/c/c_20250612_10781696.shtml)。

这些资料用于确定系统需要哪些规则字段和执行限制；实际券商接口、账户权限与数据源的交易状态仍需在接入时核验，不能用一份静态设计替代运行日规则。

## 4. 设计假设及缺口

| 假设或缺口 | 当前处理 | 何时验证 |
|---|---|---|
| 《轮回》不是完整、无矛盾的交易规则集 | 每条经验标注来源、代理变量、反证和研究状态 | 每个 playbook 实现及实验登记时 |
| 情绪值、880005 成分与计算方法不明 | 不直接使用其绝对数值；先自定义透明特征 | 获取指标定义和授权数据后 |
| 容量模式另移文档 | 留空，只有散落关联描述，不补造完整策略 | 用户提供相应文档后 |
| 资金规模、券商、数据源未给定 | 账户与行情采用接口设计；首版回放/paper | 分别在 M1/M2/M5 冻结 |
| 成交与盘中时序数据可能不足 | 分钟级只支持相应粒度的研究；排队策略禁用 | 数据可用性审计后 |
| LLM 可能记得历史事件结局 | 匿名对照、禁用历史回放联网、前瞻 paper | 所有历史模型评测报告 |
| 多 agent 可提供反证，但不独立 | 不以投票数或模型自信决定仓位 | 消融与成本评测 |
| 风险阈值无用户个性化约束 | paper 参数明示为待验证初值 | 模拟前冻结，实盘单独设置 |

## 5. 当前验证范围

本次仅检查设计资料和契约：原件哈希、段落引用、内部链接、JSON Schema 及合成示例。未来必须执行的运行时、数据、撮合、账本和策略验收列在对应章节，不混称为已通过测试。

已完成的契约检查：使用 `jsonschema 4.25.1` 的 Draft 2020-12 校验器检查 3 份 schema、2 个合成文件中的 5 个对象；检查快照/证据/计划/退出规则哈希、引用和时间先后；8 个无效结构反例均被拒绝，包括零预占、WAIT 携带买单、缺失计划哈希及无法证明的历史可用时间。原件 SHA-256、179 处段落编号引用和 27 条本地文档链接检查通过。这些检查证明设计工件的一致性，不证明运行时风控已经生效。
