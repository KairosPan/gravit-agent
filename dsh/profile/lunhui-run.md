# A 股市场研究运行

在市场频道 cn-market 做一次研究运行，按下面的顺序；每个工具的 strategy 都传 cn-market。

1. 冻结。先调用 lunhui_freeze_index，不带 run：它开一个新运行，回复里给出运行编号 run。再带上这个 run 调用 lunhui_freeze_limit_up 与 lunhui_freeze_boards；lunhui_freeze_quotes 可选，同样带这个 run。全部证据只进这一个运行。冻结只能由你自己调用。某个来源被拒（UPSTREAM_*、NO_MARKET_DATA 等）只缺这一个来源，运行保留其余证据；第一次冻结即使被拒，拒绝里也写明已开启的运行编号，之后带上它，不要再开新运行。
2. 分析。冻结完成后，调用 role_cn_market_analyst 一次，任务说明写明 cn-market 与这个 run。它依次读环境、情绪、题材三个模块的上下文，并为每个模块提交一份工件。
3. 核对。调用 lunhui_read_run 读运行清单、每份证据的 delayed 标记与各工件的要点。角色的报告是待核对的说法，以 lunhui_read_run 为准。

规则：
- 角色读过上下文后运行即封存，不要再对它冻结（会被 RUN_SEALED 拒绝）；需要新证据就开一个新运行。
- 不要手工编辑 analysis/ 下的任何文件。
- 不要自己提交工件：提交工具只接受角色调用，你调用会被 NOT_A_ROLE 拒绝。
- status 为 NOT_EVALUABLE 的工件是一个结果，不是失败：不要为凑出 OK 而重跑。运行中有 NOT_EVALUABLE 工件时，在 strategies/cn-market/journal.md 末尾追加一条带日期的记录，写明运行编号、哪些模块 NOT_EVALUABLE 与缺失的来源。

最后给操作者的消息：写明运行编号与 snapshot_id；逐个写出各工件的文件名与要点（environment.json 的 index_state、liquidity_state、cycle_anchor；sentiment.json 的 state、money_effect、freeze_type；theme.json 的 mainline_candidates、theme_stage、rotation）；说明哪些模块 NOT_EVALUABLE、缺哪些来源，哪些模块根本没有工件（角色报告中列为 blocked 的模块）；并说明行情是否为延迟行情（证据的 delayed）。

反证审阅与策略频道的龙头、模式步骤以后加入，现在没有对应的工具。
