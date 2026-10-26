# S02 旧线退潮后的新方向确认

**Status:** idea · **Owner:** agent + operator

## Thesis
**假设**：旧线负反馈中，有公开独立催化的新方向形成持续、跨个股、可交易响应，可能出现切换机会。依据：P0186–P0196、P0401–P0403、P0672–P0675、P0855–P0860、P1333–P1343、P1405–P1426。

Quoted from `docs/research/lunhui/design/docs/strategy-spec.md` §4 and the parts of its opening, §2
and §5 that apply to S02; the § numbers below are that file's. `Pxxxx` is a 《轮回》 paragraph
id, cited by id only (`docs/research/lunhui/README.md` §8).

## Rules
- Universe / screen: 沪深主板非风险警示普通A股；状态和候选门槛：
  - 市场允许 `CHAOS / IGNITION / REPAIR / EXPANSION`，禁止 `RETREAT / CLIMAX / UNKNOWN` 新增。**旧题材退潮不等于全市场退潮**；系统性亏钱仍在扩散时不靠“新方向”豁免。
  - 旧线此前已入计划，广度、核心与篮子连续满足退化条件，登记 `old_theme_retreat`；单只旧龙断板不够。
  - 新方向有决策前公开可核验的催化/经营证据；名称、代码、字辈、旧线补涨不算独立催化，证据不足仅研究。
  - 候选在观察窗开始前入池。盘中新发现先建修订，再观察之后窗口，不用此前拉升补足确认。
- Entry: 事件序列与联合触发：
  1. **证据确认 `E`**：建立催化原文、`available_at`、受益链及公司关联；谣言、无出处小表格或模型自行生成关系不满足。
  2. **广度确认 `B`**：篮子达到成员下限，排除自身后的广度、相对收益和同刻成交额满足 `k_new` 个完整观测；单票涨停不够。
  3. **持续与参与确认 `P`**：负尾部未超限，候选相对地位、报价与成交持续性达标；全板块一字买不到，不改买任意后排。
  4. **切换而非共振下跌检查 `R`**：市场 `loss_rate` 未超限，旧线负反馈未系统扩散，新线相对强度保持；负相关不证明资金来源。
  5. **计划匹配**：`E AND B AND P AND R` 加共享门槛全过、价格/时间未越界才 `PROPOSE`；否则 `WATCH / WAIT`。
     - 共享门槛（§2.1）：入场要求 `DataOK AND MarketOK(S) AND ExecutionEligible AND PlanValid`。后者要求计划早于观测窗、未过期且无否决证据。
     - 预期卡（§2.2）：`ExpectationPlan` 冻结版本、候选/题材、锚点、状态、触发/否决、窗口、价格区间、持有期及“符合/强于/弱于预期”分支（P1426、P1634–P1643）。修订仅影响之后窗口。
     - 不抢竞价或首板，不以后续三四板反证首日新周期；确认长度待检验（P0187）。
- Exit / stop: 催化辟谣、业务关系不成立、广度持续衰退、核心地位丢失、新旧线同步恶化或市场进入禁止状态，触发提案失效及退出评估。持有期和失效价预先登记；孤立上涨不升级“真龙”以延期。退潮退出与 `WAIT` 为通用管理（§5）。
- Position notes: 通过后仅可 `PROPOSE`，数量由独立风控确定（§2.1）。独立风控限制单股、题材、总风险、流动性与损失预算。确信度不决定仓位，“满仓”（P0028、P0188、P0205）仅为研究假设。退出优先于格局叙事，止损价不保证成交（§5）。

## Falsification
**不是见涨就算新主线**：独立证据、多股响应、持续确认和风险约束必须齐备；最强单票、短时负相关或传闻不足以完成 `E/B/P/R`。

待验证参数（预登记：参数在训练区间选择后冻结，不能见走势后改动）：需要催化及可用时点、题材关系、旧线事件、分钟行情、市场广度/负尾部与报价。研究旧线退化阈值/窗口、`N_min`、`k_new`、篮子收益/广度/量能、催化有效期、价格区间和 `H`。

参数约束（§2.2）：本轮不设未经验证的生产值，参数版本不完整则不可评估。原文情绪1500/3500、封单8/10/15亿、竞昨成比5/15/20%等仅为研究候选（P0094、P0130、P0203–P0204、P0455–P0457、P0802、P0874、P0888）。

Not evaluable today: no A-share point-in-time bed, no minute bars, no frozen theme membership, no pre-registered expectation plans — a Lunhui read-only run (`analysis/<run>/`) is observation, not a decision of these terms.
