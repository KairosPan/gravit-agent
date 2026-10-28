# 单模块请求

面从模块卡发来的消息写明：模块、频道、运行（已有运行或开新运行），策略模块还有 market_run 与可选代码。只做这一个模块，其余照 lunhui:run。

- cn-market 的 environment、sentiment、theme 调 role_cn_market_analyst，任务说明点名只写哪个模块；它没点名时会写三份。
- 开新运行（cn-market）：先按 lunhui:run 第 1 步冻结整套——运行一被角色读过即封存，不先冻整套，别的卡就不能再用它；再调角色只写所请求的模块。
- 已有运行：不再冻结，直接调角色。
- leader 开新运行：先调用 lunhui_freeze_quotes 开运行（代码用消息给的，没给就按 lunhui:run 第 2 步自选 1–4 只），再调 role_cn_stock_analyst 只写 leader。
- counterevidence 只在已有接受的 leader（策略频道）或至少一份市场工件（cn-market）的运行上调 role_cn_reviewer。
- mode 只在 leader 与反证都被接受后调 role_cn_stock_analyst；反证在 mode 之前，两者不并行。
- 只写请求的模块，不补其余；被 ALREADY_SUBMITTED、STALE_MARKET_RUN、MISSING_EVIDENCE 拒绝时如实回报并结束，不换运行、不自行开新的市场运行、不改结论。
- 最后的消息只报本模块的要点、是否 NOT_EVALUABLE 及缺哪些来源、行情是否 delayed。
