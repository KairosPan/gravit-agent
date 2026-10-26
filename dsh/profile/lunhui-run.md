# A 股市场研究运行

在市场频道 cn-market 做一次研究运行，按下面的顺序；每个工具的 strategy 都传 cn-market。

1. 冻结。先调用 lunhui_freeze_index，不带 run：它开一个新运行，回复里给出运行编号 run。再带上这个 run 调用 lunhui_freeze_limit_up 与 lunhui_freeze_boards；lunhui_freeze_quotes 可选，同样带这个 run。全部证据只进这一个运行。冻结只能由你自己调用。某个来源被拒（UPSTREAM_*、NO_MARKET_DATA 等）只缺这一个来源，运行保留其余证据。
2. 分析。冻结完成后，调用 role_cn_market_analyst 一次，任务说明写明 cn-market 与这个 run。它依次读环境、情绪、题材三个模块的上下文，并为每个模块提交一份工件。
3. 核对。调用 lunhui_read_run 读运行清单、每份证据的 delayed 标记与各工件的要点。角色的报告是待核对的说法，以 lunhui_read_run 为准。

规则：
- 角色读过上下文后运行即封存，不要再对它冻结（会被 RUN_SEALED 拒绝）；需要新证据就开一个新运行。
- 不要手工编辑 analysis/ 下的任何文件。
- 不要自己提交工件：提交工具只接受角色调用，你调用会被 NOT_A_ROLE 拒绝。
- status 为 NOT_EVALUABLE 的工件是一个结果，不是失败：照实记下缺了哪些来源，不要为凑出 OK 而重跑。

最后给操作者的消息：写明运行编号与 snapshot_id；逐个引用各工件的要点（环境的 index_state、liquidity_state、cycle_anchor；情绪的 state、money_effect、freeze_type；题材的 mainline_candidates、theme_stage、rotation）；说明哪些模块 NOT_EVALUABLE、缺哪些来源；并说明行情是否为延迟行情（证据的 delayed）。

反证审阅与策略频道的龙头、模式步骤以后加入，现在没有对应的工具。
