# cn-market

**Status:** idea · **Owner:** agent + operator

## Thesis
本频道的论题就是市场读数本身：不属于任何单一策略，而是给每个策略的运行提供可引用的环境、情绪和题材判断。三条假设均用本仓库自己的话写成，只引段落编号（`Pxxxx` 为《轮回》段落编号，按 `docs/research/lunhui/README.md` §8 只引编号、不引原文）。

1. **环境与大周期**（一 P0019–P0074，八 P1652–P1708）：指数所处位置和成交流动性构成一个可单独陈述的背景；指数状态与流动性状态分开报告，不合并成一个分数。背景偏弱时，短线结论的可信度应随之下调。
2. **情绪周期**（二 P0156–P0163，P0020–P0056）：短线情绪由涨停、连板、炸板与昨日涨停股的次日表现共同刻画，并在若干状态间轮转。状态标签取七个之一：`UNKNOWN`、`CHAOS`、`IGNITION`、`EXPANSION`、`CLIMAX`、`RETREAT`、`REPAIR`。这些标签是可修订的工作标签，不是事实；下一交易日的冻结证据可以推翻它。
3. **题材与轮动**（P0075–P0153，六 P1345–P1464）：资金在题材之间集中与切换；主线候选应同时表现为板块广度、涨停集中和成交占比，单一个股的上涨不构成题材。题材所处阶段与轮动方向同样是可修订的标签。

## Rules
- Universe / screen: 沪深 A 股全市场读数：指数、涨停池（含炸板、跌停、昨日涨停）、行业与概念板块；个股报价可选。
- Run order（spec §5.10、A22，本频道部分）：先冻结 index、limit-up、boards（quotes 可选），再由 `cn-market-analyst` 凭运行编号写出环境、情绪、题材三个产物，最后由 `cn-reviewer` 写反证。角色读取上下文之后不再补冻；`analysis/<run>/` 不手改。上述角色与模块行属于后续计划，这里只记顺序，不表示它们今天已存在。
- Entry: 无。本频道不交易。
- Exit / stop: 无。
- Position notes: 无持仓。策略频道的 `mode.json` 引用本频道的某次运行；引用不等于本频道对任何标的下结论。

## Falsification
一个状态标签错了，当且仅当下一交易日的冻结证据与它矛盾：要么当日支撑该标签的证据被推翻，要么次日证据不符合该标签可以转入的任何状态。状态本会轮转，次日与当日不同本身不算证伪。用于判断的是冻结时由宿主代码算出的派生量，不是模型的复述：`streak_distribution`、`seal_ratio`、`break_ratio`、`yesterday_return_median`、`yesterday_negative_tail`、`breadth`、`turnover_share`、`advance_decline_ratio`、`limit_up_count`、`limit_down_count`、`total_turnover`。例如标为 `EXPANSION` 而次日 `limit_up_count` 回落、`break_ratio` 上升、`yesterday_negative_tail` 扩大，若这组读数符合 `CLIMAX` 或 `RETREAT`，是状态转入而非证伪；若它说明当日的 `EXPANSION` 读数本身站不住（例如当日的 `streak_distribution` 与 `seal_ratio` 并不支持扩张），或次日读数不符合任何可转入的状态，则该标签被证伪；标为某题材主线而次日其 `breadth` 与 `turnover_share` 同时走弱，则该题材判断被证伪。

最终的评判者是引用了本频道某次运行的策略运行的预期复盘（`expectation_review`）：复盘逐条对照当时引用的标签与后来的冻结证据，记录哪些成立、哪些不成立。未经此复盘的标签只是观察，不是已验证的读数。
