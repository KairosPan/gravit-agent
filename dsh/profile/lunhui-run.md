# A 股研究运行

市场频道 cn-market 与策略频道各按下面顺序。工具的 strategy 传所在频道名。

## 市场频道 cn-market

1. 冻结。先调用 lunhui_freeze_index，不带 run：它开一个新运行，回复给出运行编号 run。再带 run 调用 lunhui_freeze_limit_up 与 lunhui_freeze_boards；lunhui_freeze_quotes 可选，同样带 run。某来源被拒（UPSTREAM_*、NO_MARKET_DATA 等）只缺这个来源；第一次冻结被拒时，拒绝里也写明已开启的 run，之后带上它，不要再开新运行。
2. 分析。调用 role_cn_market_analyst 一次，写明 cn-market 与 run；它提交环境、情绪、题材三份工件。
3. 反证。调用 role_cn_reviewer，写明 cn-market 与 run，不传 market_run。
4. 核对。调用 lunhui_read_run 读运行清单、证据的 delayed 标记与工件要点。角色的报告待核对，以读到的为准。

## 策略频道

1. 找市场运行。对 cn-market 调用 lunhui_read_run，不带 run：列出最近已封存的运行。取 session 为当日或前一个交易日的一个，记为 market_run；没有就先做上一节。
2. 选股。带 run 读它，从 theme.json 的 mainline_candidates 板块成分股与涨停池里选 1–4 只主板个股（sh60xxxx、sz00xxxx）。
3. 冻结。对本策略调用 lunhui_freeze_quotes，不带 run，传这些代码：它开一个策略运行 run。
4. 龙头。调用 role_cn_stock_analyst，写明策略、run、market_run，写 leader。
5. 反证。调用 role_cn_reviewer，同样三项。
6. 模式。leader 被接受后，再调用 role_cn_stock_analyst，同样三项，写 mode。
7. 核对。调用 lunhui_read_run 读本运行。

WAIT、NOT_EVALUABLE 工件与被拒的 mode 都是结果，不是失败：不要为改结论重跑。读取被 STALE_MARKET_RUN 拒绝时，先冻结新的 cn-market 运行，以它作 market_run 重读；leader 被接受前，已封存的策略运行仍可这样重读，之后 mode 只认 leader 引用的 market_run。

## 规则

- 冻结只能由你调用。角色读过上下文后运行即封存，再冻结会被 RUN_SEALED 拒绝；需要新证据就开新运行。
- 不要手工编辑 analysis/ 下的任何文件。
- 不要自己提交工件：提交工具只接受角色，你调用会被 NOT_A_ROLE 拒绝。
- 运行中有 status 为 NOT_EVALUABLE 的工件时，在本频道 journal.md 末尾追加带日期的一条：运行编号、哪些模块、缺失的来源。

最后给操作者的消息：运行编号与 snapshot_id；各工件要点（environment.json 的 index_state、liquidity_state、cycle_anchor；sentiment.json 的 state、money_effect、freeze_type；theme.json 的 mainline_candidates、theme_stage、rotation；leader.json 的 leader_candidates；counterevidence.json 的条目数；mode.json 的 mode 与 market_run）；哪些模块 NOT_EVALUABLE、缺哪些来源，哪些没有工件（角色报告 blocked）；行情是否延迟（delayed）。
