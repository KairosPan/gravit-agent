# 轮回 (Lunhui) — frozen research input

## 1. What this is

The Lunhui design package — an A-share trading-agent design whose only built part is a read-only
research entry, built on 《轮回》, a third party's trading text — frozen here as an input to
Gravit's A-share research. Source: the sibling repository `evolving-alpha`, branch
`codex/lunhui-agent-design`, commit `2ae4df0`, copied 2026-10-19 under the graft spec
(`docs/superpowers/specs/2026-10-19-lunhui-plugin-graft-design.md`, its decisions cited below as
spec Dn). Like the rest of `docs/research/`, nothing here is edited.

| Path | What | In git |
|---|---|---|
| `README.md` | this file | yes |
| `manifest.json` | the source's `references/lunhui/manifest.json`, untouched: the docx's sha256, its paragraph and table counts, and the hash of each embedded media file | yes |
| `design/README.md`, `design/docs/*.md` (eight) | the source's `README.md` and `docs/*.md`, byte-identical below a one-line header comment naming the commit | yes |
| `design/contracts/*.schema.json` (three), `design/examples/*.json` (two) | the source's `contracts/` and `examples/`, byte-identical; JSON takes no header, so this file names their commit | yes |
| `corpus/` | the source's `references/lunhui/` without the manifest: `extracted.txt`, `paragraphs.json`, `tables.json`, `image-anchors.tsv`, `轮回.docx` | no — gitignored (spec D11) |

Links inside `design/` keep the source tree's layout: its `references/lunhui/` is `corpus/` here
(`manifest.json` sits beside this file), and its `frontend/` was not copied.

S01 主线核心分歧修复 and S02 旧线退潮后的新方向确认 are hypotheses under test in
`strategies/lunhui-*`, not preferences (spec D10). Their theses, joint triggers and failure terms
live in those directories' `THESIS.md`; the operator's preferences are the `doctrine` skill's
(`dsh/skills/style-gravit/doctrine/`). Both are `DESIGN_ONLY` (`design/docs/strategy-spec.md` §8)
and stay not evaluable without minute bars, frozen 题材 membership and catalyst evidence
(`design/README.md`).

## 2. The corpus: hashes and a hand restore

`corpus/` stays out of git: this repository is public and 《轮回》 is a third party's text (spec
D11). The tree keeps these hashes, the docx's in `manifest.json` as well, and cites the text by
paragraph id only (§8).

| File | sha256 |
|---|---|
| `extracted.txt` | `452c2dfc328453ab9f9d068213a583ddb404c2775d2045d73bec1f48971ef234` |
| `paragraphs.json` | `0dbcc093ec2a4b7cf1936ccb4c8109bd432ce37feae95f4806cba487be745929` |
| `tables.json` | `5e99713e4b4c9b91fb16e45ef6a9c532a96094121844525c160423c406bdb859` |
| `image-anchors.tsv` | `fd3cbd27057db8309d1348aa2bec26d1aa2082792eeb0a25fe1f7e5a22471837` |
| `轮回.docx` | `8afc44a3163f706188db4aea5fa688aa40a13f06c30b19471c6e0a14d37b74d6` (= `manifest.json` `sha256`) |

To restore `corpus/` by hand, from this repository's root, with `<repo>` a clone of the sibling
repository that holds commit `2ae4df0`:

```bash
mkdir -p docs/research/lunhui/corpus
git -C <repo> show 2ae4df0:references/lunhui/extracted.txt > docs/research/lunhui/corpus/extracted.txt
git -C <repo> show 2ae4df0:references/lunhui/paragraphs.json > docs/research/lunhui/corpus/paragraphs.json
git -C <repo> show 2ae4df0:references/lunhui/tables.json > docs/research/lunhui/corpus/tables.json
git -C <repo> show 2ae4df0:references/lunhui/image-anchors.tsv > docs/research/lunhui/corpus/image-anchors.tsv
git -C <repo> show 2ae4df0:references/lunhui/轮回.docx > docs/research/lunhui/corpus/轮回.docx
cd docs/research/lunhui/corpus && shasum -a 256 extracted.txt paragraphs.json tables.json image-anchors.tsv 轮回.docx
```

The five hashes must equal the table's. A plain copy of the five files from `references/lunhui/`
in a clean checkout of `2ae4df0`, made without checkout conversion, gives the same bytes (the
2026-10-19 copy was made that way);
the hashes are the check either way, and
`git check-ignore -q docs/research/lunhui/corpus/extracted.txt` confirms the directory is still
ignored.

## 3. 三层分离: 原文 / 观测代理 / 工程裁决

The package records three things apart and never lets one stand in for another
(`design/docs/strategy-spec.md`, its opening note and §1): 原文, the experience 《轮回》
records, cited by paragraph id; 观测代理, the point-in-time observable that stands in for it,
with its limit stated; and 工程裁决, the design's own ruling where the text is silent,
contradicts itself or claims a certainty (§6 below; the rows marked 工程裁决 in strategy-spec.md
§5). strategy-spec.md §1 applies it to five layers: 环境 (P1651–P1703; whether technical
divergence works is unproven), 情绪 (P0020–P0045, P0454, P0532; "4板以下退潮结束" is not
assumed), 题材 (P0186–P0308, P0337–P0363; a later 二波 does not prove after the fact that the
题材 was big), 个股 (P0665–P0689, P1275–P1277; leading in time is not causation) and 预期/纪律
(P0011–P0012, P1634–P1643; "满仓" and "体面离场" are never written as trading guarantees).
Market state is kept apart from 题材 and 个股 (§4 below). 龙头 is a point-in-time hypothesis,
`leader_candidate`; several roles may coexist (P0659–P0663, P0706–P0710), and no winner known
after the fact is written back into the candidates. Parameters are chosen on a training window
and frozen, never moved after the price path is seen.

## 4. The seven market states: revisable hypotheses

`design/docs/system-design.md` §4 keeps four things apart — the index and liquidity
environment, market-wide 情绪, 题材 stage and 个股 standing: a warming market does not make every
题材 buyable, and one strong high-position stock does not mean the market has entered a new
cycle. The seven market-state candidates are revisable hypotheses, not ground truth, and follow
no fixed order: any state may move straight to `UNKNOWN` or `RETREAT`; a change records the
evidence that moved it and the previous version, and never rewrites a past label; double
thresholds and a minimum confirmation window damp flicker, their parameters chosen on training
samples; a sudden risk event may cut exposure or stop new entries directly. system-design.md §4
defines the seven no further; what the package says of each:

- `UNKNOWN` — marked when indicators conflict strongly, a conflict no LLM narrative may resolve,
  and allowed whenever evidence is insufficient; neither S01 nor S02 adds risk in it, and 未知
  means `WAIT` (system-design.md §4, risk-and-evaluation.md §1, strategy-spec.md §3–§5).
- `CHAOS` — S02's state gate admits it; S01 does not yet apply to it; and the 混沌不做一进二
  ruling bans the generic 一进二, so S02 there needs its own catalyst and continuous-auction
  confirmation, and a market 退潮 still vetoes it (strategy-spec.md §3–§4 and §7).
- `IGNITION` — S02's state gate admits it; S01 does not yet apply to it (strategy-spec.md §3–§4).
- `EXPANSION` — both S01's and S02's state gates admit it (strategy-spec.md §3–§4).
- `CLIMAX` — neither S01 nor S02 adds risk in it, and the 启动高潮 vs 赶顶高潮 ruling keeps
  catalyst timing and stage apart (strategy-spec.md §3–§4 and §7).
- `RETREAT` — neither S01 nor S02 adds risk in it; a market 退潮 stops new risk and cancels the
  proposals it invalidates while existing risk follows the pre-registered `REDUCE / EXIT`, and an
  old 题材's 退潮 is not a market-wide 退潮 (strategy-spec.md §3–§5).
- `REPAIR` — both S01's and S02's state gates admit it (strategy-spec.md §3–§4).

## 5. R01–R14: the other strategy families

`design/docs/strategy-spec.md` §6 registers fourteen more families as `research_only`: banned
from execution in the first version, never an implied exception to S01/S02, each promoted only
on its own validation. Family names as the source spells them; each row's exact wording is in
strategy-spec.md §6.

| Code | Family and paragraphs | What is unsolved |
|---|---|---|
| R01 | 冰点反核/地天; P0454–P0544, P1042–P1075 | telling a 启动 冰点 from a 衰竭 冰点 beforehand; extreme liquidity |
| R02 | 一进二/竞价弱转强; P0835–P0889 | conflicting cycle rules; 竞价 execution and how its volume and amount are measured |
| R03 | 加速/高位接力/突破高度; P0719–P0731, P0826–P0833 | crowding, queueing and tail risk |
| R04 | 一字开板/T板/尾盘回封; P0905–P0965 | finer 盘口 data, queueing and cancellations; minute bars are not enough |
| R05 | 首阴反包/上影线/出货分时; P0979–P1039, P1090–P1099 | a complete sample of failures; 主力 intent cannot be guessed |
| R06 | 二三波/老龙反抽/平台低吸; P0444–P0448, P1106–P1169 | the 平台, the 题材 level, the point in time of 复权 |
| R07 | 补涨/属性发散; P1172–P1263, P1376–P1401 | telling a business link from co-movement and from a coincidence of names |
| R08 | 题材轮动/低吸弱方向; P0112–P0117, P1345–P1374 | a frozen 题材 pool; the risk that the weak keep weakening |
| R09 | 事件埋伏/逻辑挖掘; P0090–P0092, P1405–P1433 | the information's timing, credibility and 兑现; evidence only in the first version |
| R10 | 失败者/梯队/补涨套利; P1435–P1464 | not risk-free; the core and its followers falling together |
| R11 | 容量趋势; P0005, P0827, P1696 | the source moved it to another document; the material is incomplete |
| R12 | 20cm/ST/北交/转债生态; P0229–P0233, P1591–P1596, P1697–P1703 | outside the product's scope; needs its own rules, costs and execution |
| R13 | 新股/次新/临停; P1503–P1583 | listing-stage mechanics, sparse samples, 打法失效 |
| R14 | 唯一反弹/指数形态择时; P0049–P0056, P1466–P1497, P1651–P1686 | absolute claims, the subjectivity of chart patterns; state research only |

The 大基金 part (P1709–P1711) carries only numbers without a complete source and is neither a
strategy nor a calibration basis.

## 6. The ten conflict rulings

The source's main conflicts and 偏差, and the first version's explicit ruling on each
(`design/docs/strategy-spec.md` §7; exact wording there):

| # | Conflict and paragraphs | First-version ruling |
|---|---|---|
| 1 | 混沌不做一进二 vs 混沌/退潮试错: P0016 vs P0574, P0782, P0855 | no generic 一进二; S02 needs an independent catalyst and confirmation in 连续竞价, and a market 退潮 still vetoes |
| 2 | 极值次日必反弹 vs 继续退潮: P0536 vs P0534, P0454 | no prediction of a certain rebound; S01 needs joint confirmation after the 分歧 |
| 3 | 死于分歧的都不是真龙: P0755–P0757 | the circular definition is rejected; every ex-ante candidate is kept, failures included, and exits when invalidated |
| 4 | 弱转强买点 vs 逆周期卖点: P0780–P0784 vs P0822–P0823, P1272 | the state veto comes first; a strong stock does not override a market-wide 退潮 |
| 5 | 断板切换 vs 首阴反包继续: P0403 vs P0285–P0288 | 断板 is not a sufficient condition; read the basket's negative feedback, and existing holdings keep their plan's risk control |
| 6 | 竞价量大好 vs 大额出货: P0874, P0888, P0819 | neither the ratios nor a monotonic assumption is carried over; in the first version 竞价 is only observed |
| 7 | 启动高潮可做 vs 赶顶高潮退出: P0337–P0348 | catalyst timing and stage are kept apart; no new risk in `CLIMAX`, `WAIT` when unknown |
| 8 | 重仓不怕高 vs 明牌龙不追高: P0205–P0217 vs P1110 | an independent position budget and price band, never loosened by borrowing from another 生态 |
| 9 | 保本/无抛压/无风险: P0524, P0744–P0745, P1093–P1094, P1525 | no guarantee-style conclusion is adopted; replays include unfillable orders and consecutive declines |
| 10 | 新龙3–5倍、节后必反抽等: P0068, P1157, P1694–P1697 | no guaranteed return; the parent sample holds every ex-ante candidate |

## 7. Every number is a research candidate

Every number in the source — 情绪 1500/3500, 封单 8/10/15 亿, 竞昨成比 5/15/20% and the like —
is a research candidate, not a parameter (`design/docs/strategy-spec.md` §2.2: P0094, P0130,
P0203–P0204, P0455–P0457, P0802, P0874, P0888). The package sets no unvalidated production value,
and a strategy whose parameter version is incomplete is not evaluable; `880005` and the 情绪值
definition are incomplete, so the first version does not rely on them.

## 8. Citing a paragraph

Cite 《轮回》 by paragraph id only — `P0243`, a range as `P0243–P0265` — never by pasting its text
into the tree. The ids follow the OOXML paragraph order of `word/document.xml`, table paragraphs
included; empty paragraphs keep their numbers, so the ids skip, and they are not page numbers
(`design/docs/sources.md` §1, `design/README.md`). To read one, from the repository root:

```bash
grep -n '^\[P0243\]' docs/research/lunhui/corpus/extracted.txt
```

`extracted.txt` holds the 1,206 non-empty paragraphs, one `[Pxxxx] text` line each;
`paragraphs.json` holds the same as `{id, text}`; `tables.json` maps each table cell to its
paragraph ids; `image-anchors.tsv` maps a paragraph id to an embedded image.
