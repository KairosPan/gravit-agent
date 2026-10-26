# A 股研究运行

市场频道 cn-market 与策略频道各按下面的顺序。工具的 strategy 传所在频道名。

## 市场频道 cn-market

1. 冻结。先调用 lunhui_freeze_index，不带 run：它开一个新运行，回复给出运行编号 run。再带这个 run 调用 lunhui_freeze_limit_up 与 lunhui_freeze_boards；lunhui_freeze_quotes 可选，同样带这个 run。某个来源被拒（UPSTREAM_*、NO_MARKET_DATA 等）只缺这一个来源；第一次冻结被拒时，拒绝里也写明已开启的运行编号，之后带上它，不要再开新运行。
2. 分析。调用 role_cn_market_analyst 一次，任务说明写明 cn-market 与这个 run；它为环境、情绪、题材各提交一份工件。
3. 核对。调用 lunhui_read_run 读运行清单、证据的 delayed 标记与工件要点。角色的报告是待核对的说法，以它为准。

## 策略频道

1. 读市场。以 lunhui_read_run 读当日已封存的 cn-market 运行，记下其编号 market_run；还没有就先做上一节。
2. 选股。从它 theme.json 的 mainline_candidates 板块成分股与涨停池里选 1–4 只主板个股（sh60xxxx、sz00xxxx）。
3. 冻结。对本策略调用 lunhui_freeze_quotes，不带 run，传这些代码：它开一个策略运行 run。
4. 龙头。调用 role_cn_stock_analyst，任务说明写明策略、run、market_run，写 leader。
5. 模式。再调用 role_cn_stock_analyst，同样三项，写 mode。
6. 核对。调用 lunhui_read_run 读本运行。

mode 是每日登记：WAIT 是结果，不是失败，不要为改结论重跑。读取被 STALE_MARKET_RUN 拒绝时，先冻结一个新的 cn-market 运行，再为本策略开一个新运行（已封存的运行不能改引）。反证审阅一步以后加入，现在没有对应的工具。

## 规则

- 冻结只能由你调用。角色读过上下文后运行即封存，再冻结会被 RUN_SEALED 拒绝；需要新证据就开新运行。
- 不要手工编辑 analysis/ 下的任何文件。
- 不要自己提交工件：提交工具只接受角色调用，你调用会被 NOT_A_ROLE 拒绝。
- status 为 NOT_EVALUABLE 的工件是一个结果：不要为凑出 OK 而重跑。cn-market 运行中有这样的工件时，在 strategies/cn-market/journal.md 末尾追加一条带日期的记录：运行编号、哪些模块、缺失的来源。

最后给操作者的消息：运行编号与 snapshot_id；各工件的文件名与要点（environment.json 的 index_state、liquidity_state、cycle_anchor；sentiment.json 的 state、money_effect、freeze_type；theme.json 的 mainline_candidates、theme_stage、rotation；leader.json 的 leader_candidates；mode.json 的 mode 与 market_run）；哪些模块 NOT_EVALUABLE、缺哪些来源，哪些没有工件（角色报告中列为 blocked）；行情是否延迟（delayed）。
