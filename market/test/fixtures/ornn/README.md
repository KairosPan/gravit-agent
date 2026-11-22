# Ornn fixtures (Task 2), read once 2026-11-22 (05:30–07:20 UTC), one GET per URL, browser user agent, Accept: application/json; all HTTP 200, keyless

| File | URL | Shape |
|---|---|---|
| daily-all.json | https://data.ornn.com/api/public-index/daily-index/all | `{ success, date, data: [{ gpu_type, region: "global", index_value, date }], count: 7 }` — settle 2026-11-21T05:00Z: A100 SXM4 1.01, B200 9.09, B300 11.51, H100 SXM 2.89, H200 6, RTX 5090 0.68, RTX PRO 6000 WS 1.52 ($/GPU·hr) |
| h100-history.json | https://data.ornn.com/api/public-index/gpu/H100%20SXM/index-history | `{ success, gpu_type, access: "public-3mo", data: [{ timestamp, index_value }] }`, 91 points from 2026-08-23T04:00Z |
| rtxpro-history.json | …/gpu/RTX%20PRO%206000%20WS/index-history | same shape (a name with spaces, URL-encoded) |
| h100.json | https://api.ornnai.com/api/gpu/H100%20SXM | `{ success, data: { gpu_name, region: "", index_value: 2.69, last_updated: "2026-11-22T05:01:30.556Z" } }` (intraday current) |
| b200.json | https://api.ornnai.com/api/gpu/B200 | same, 9.13 at 2026-11-22T07:01:12.555Z |
| otpi.json | https://data.ornn.com/api/public-index/otpi | `{ success, access, date: "2026-11-20", count: 4, data: [{ date, lab, indexPerMtok, computedAt }] }` — anthropic 0.7656, openai 0.3306, google 0.6670, deepseek 0.0338 ($/M tokens) |
| otpi-anthropic-history.json | …/otpi?lab=anthropic&startDate=2026-08-22&endDate=2026-11-21 | same shape, 90 days |
| otpi-class.json | https://data.ornn.com/api/public-index/otpi/weight-class | `{ success, access, startDate, endDate, count: 2, data: [{ date, class: "closed"|"open", indexPerMtok, labsPriced }] }` — closed 0.5658, open 0.0620 |
| otpi-class-closed-history.json | …/otpi/weight-class?class=closed&startDate=2026-08-22&endDate=2026-11-21 | same shape, 90 days |

Notes: GPU daily settles are stamped 05:00Z (daily-all) and 04:00Z (history timestamps); token settles are dates (YYYY-MM-DD). The free tier is three months; hourly prints need a paid key. Polymarket questions on these indices are titled "Will the Ornn H100 Index hit $2.25 (LOW) by December 31, 2026?" and "Will the Ornn RTX 5090 Index be between $0.65 and $0.70 on November 30, 2026?" (seen through the market's own search, 2026-11-22).

## Log
2026-11-22T07:17:32Z 200 otpi-class-closed-history.json https://data.ornn.com/api/public-index/otpi/weight-class?class=closed&startDate=2026-08-22&endDate=2026-11-21
2026-11-22T07:17:34Z 200 rtxpro-history.json https://data.ornn.com/api/public-index/gpu/RTX%20PRO%206000%20WS/index-history
2026-11-22T07:17:37Z 200 b200.json https://api.ornnai.com/api/gpu/B200
