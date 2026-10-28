// face/client/js/host/modules-view.js — the six Lunhui modules as Discover's Research cards (module cards spec §5.1,
// §5.3, Appendix A): the static table the cards share with the server, kept in step with face/src/channels.ts
// MODULE_HEADLINES, face/plugins/lunhui/lib/modules.mjs and the roles by tests/lunhui-modules-table.test.ts, joined with
// GET /data/modules.json into chips, the shelf's items and a module page's rows. Pure. Every wire string passes through
// as data for the view to escape; the manuscript is cited by paragraph id only.
import { countWord } from './runs-view.js';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : null);
const count = v => (Array.isArray(v) ? v.length : 0);

const ROUTE = 'deepseek-official/deepseek-flash';
const BUDGET = '10 calls per run · one artifact per run';
const RUNS_SHOWN = 24;
const MARKET_ANALYST = ['CN market analyst', 'cn-market-analyst'];
const STOCK_ANALYST = ['CN stock analyst', 'cn-stock-analyst'];
const REVIEWER = ['CN reviewer', 'cn-reviewer'];
const CHANNEL_WORDS = { market: 'cn-market', strategy: 'a strategy', either: 'cn-market or a strategy' };
// the directory a module writes under: strategies/<channel>/analysis/<run>/, the channel named as far as it is known
const DIR_CHANNEL = { market: 'cn-market', strategy: '<strategy>', either: '<channel>' };

// a legend row from one of Appendix A's ` · `-separated readings, `LABEL ← text`
const arrowRows = s => s.split(' · ').map(r => { const [label, text] = r.split(' ← '); return { label, text }; });
const pairRows = pairs => pairs.map(([label, text]) => ({ label, text }));

// A.2: the design's mapping of the text's stages onto the seven labels, not the text's own
const SENTIMENT_LEGEND = {
  title: "The text's stages beside the seven labels",
  rows: arrowRows(
    'CHAOS ← 混沌期 / 情绪冰点 P0161, the retreat\'s late leg P0372 · IGNITION ← 修复启动 P0165, 拐点 P0179, 情绪回暖 P0185, 题材启动日 P0191 · ' +
    'EXPANSION ← 题材启动次日 P0202, 题材发酵 P0208, 主升 P0198, P0213 · CLIMAX ← 加速高潮 P0253, P0337–P0352 · ' +
    'RETREAT ← 分化弱分歧 P0243, 大分歧 P0258, 周期转变信号 P0291, 退潮期 P0372, 方向切换 P0382 · ' +
    'REPAIR ← 修复 P0268, P0294, 转点 P0283, 超跌反抽 P0391 · UNKNOWN ← the measures disagree',
  ),
};

// A.4: top_pattern_flags as contracts/leader.mjs words them, in English
const LEADER_LEGEND = {
  title: 'The flags, as the contract words them',
  rows: pairRows([
    ['ACCELERATING', 'sealed earlier within a limit-up streak'],
    ['DIVERGENCE', 'a board broke, or broke and resealed'],
    ['BROKEN_STREAK', 'limit-up yesterday, not sealed today'],
    ['HIGH_POSITION', 'a high streak count'],
    ['FIRST_BOARD', 'a first board'],
    ['NONE', 'no flag; stands alone'],
  ]),
};

// A.5: the preconditions as contracts/mode.mjs names them, each with the class of evidence it cites when met
const THEME_CLASS = "the theme artifact with a mainline candidate, or a mainline board's row, member list or boards derived item";
const CANDIDATE_CLASS = "the leader artifact, or a candidate's quote or pool row";
const MODE_LEGEND = {
  title: 'The preconditions, as the contract names them',
  rows: pairRows([
    ['theme_gate', `S01: ${THEME_CLASS}`],
    ['candidate_before_divergence', `S01: ${CANDIDATE_CLASS}`],
    ['theme_not_falsified', `S01: ${THEME_CLASS}`],
    ['negative_tail_not_widening', 'S01: the yesterday_negative_tail derived item or the sentiment artifact'],
    ['minute_confirmation', 'S01, S02: no source today, stated unmet: no source'],
    ['old_theme_retreat', 'S02: the theme or sentiment artifact, or a boards derived item'],
    ['catalyst', 'S02: no source today, stated unmet: no source, which refuses S02'],
    ['candidates_pooled', `S02: ${CANDIDATE_CLASS}`],
  ]),
};

// A.6: the ten rulings (strategy-spec §7) by topic, each with A.6's paragraph ids, then the five kinds of an item
const COUNTEREVIDENCE_LEGEND = {
  title: 'The ten rulings and the five kinds',
  rows: pairRows([
    ['No generic one-to-two relay in a chaos phase', 'P0016 vs P0574, P0782, P0855'],
    ['No rebound presumed after an extreme low', 'P0536 vs P0534, P0454'],
    ['No true leader named by hindsight', 'P0755–P0757'],
    ['A strong stock does not override a market-wide retreat', 'P0780–P0784 vs P0822–P0823, P1272'],
    ['A broken streak alone is no switch', 'P0403 vs P0285–P0288'],
    ['Auction volume read by no fixed ratio', 'P0874, P0888, P0819'],
    ['Two climaxes read apart; CLIMAX registers nothing; an unclear state waits', 'P0337–P0348'],
    ['Size budget and price band not loosened for another ecology', 'P0205–P0217 vs P1110'],
    ['No guarantee-style claim taken as a conclusion', 'P0524, P0744–P0745, P1093–P1094, P1525'],
    ['No promised multiples; the sample holds every candidate named beforehand', 'P0068, P1157, P1694–P1697'],
    ['CONTRADICTS', "the frozen evidence and the artifact's reading disagree"],
    ['MISSING_EVIDENCE', "the artifact's conclusion lacks supporting evidence"],
    ['STALE', "the artifact takes an earlier session's evidence as this run's"],
    ['RULING_CONFLICT', 'conflicts with a ruling or the general management; the text names which'],
    ['OVERREACH', "a claim beyond its cited evidence or the module's scope"],
  ]),
};

/** @template T @param {T} o @returns {T} */
const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };

// `freezes` and `artifacts` are what the page's Reads box says the module reads, `none` where it reads nothing of a kind
const entry = (name, title, subtitle, [role, roleId], channels, headline, [freezes, artifacts], icon, legend = null) => ({
  name, title, subtitle, role, roleId, route: ROUTE, channels, channelWords: CHANNEL_WORDS[channels], file: `${name}.json`,
  headline, tools: [`lunhui_read_${name}_context`, `lunhui_submit_${name}`], freezes, artifacts, icon, legend,
});

export const MODULES = deepFreeze([
  entry('environment', 'Environment', '环境与大周期 · index · liquidity · cycle anchor', MARKET_ANALYST, 'market',
    ['index_state', 'liquidity_state', 'cycle_anchor'], ['index; quotes when frozen', 'none'], 'layers'),
  entry('sentiment', 'Sentiment', '情绪周期 · state · money effect · 冰点', MARKET_ANALYST, 'market',
    ['state', 'money_effect', 'freeze_type'], ['limit-up and index', 'none'], 'pulse', SENTIMENT_LEGEND),
  entry('theme', 'Theme', '题材与轮动 · mainline · stage · rotation', MARKET_ANALYST, 'market',
    ['mainline_candidates', 'theme_stage', 'rotation'], ['boards and limit-up', 'none'], 'flame'),
  entry('leader', 'Leader', '龙头与个股地位 · candidates · 顺位 · pattern flags', STOCK_ANALYST, 'strategy',
    ['leader_candidates', 'top_pattern_flags'],
    ["the run's quotes", "the cited market run's limit-up pools, mainline member lists, theme and sentiment artifacts"], 'podium', LEADER_LEGEND),
  entry('mode', 'Mode', '模式选择与预期 · mode · preconditions · expectation', STOCK_ANALYST, 'strategy',
    ['mode', 'preconditions', 'research_only_matches', 'expectation', 'expectation_review'],
    ['none', "the run's leader and counterevidence · the cited market run's three artifacts · the previous mode card"], 'switch', MODE_LEGEND),
  entry('counterevidence', 'Counterevidence', '反证 · items against the accepted artifacts', REVIEWER, 'either',
    ['items'], ['none', "the run's accepted artifacts and evidence rows · a strategy: the cited market run's too"], 'shield', COUNTEREVIDENCE_LEGEND),
]);

export const MODULE_NAMES = new Set(MODULES.map(m => m.name));

export const moduleOf = name => MODULES.find(m => m.name === name) ?? null;

// the channels a module reads: a market module cn-market, a strategy module every other channel, either all
const accepts = (m, c) => m.channels === 'either' || c?.kind === m.channels;
const channelsOf = listing => (Array.isArray(listing?.channels) ? listing.channels.filter(plain) : []);
const runsIn = c => (Array.isArray(c.runs) ? c.runs.filter(r => plain(r) && typeof r.run === 'string') : []);
// run ids open with the UTC second, so string order is time order
const newer = (a, b) => (a.run > b.run ? -1 : a.run < b.run ? 1 : 0);
const artifactOf = (run, name) => (plain(run.artifacts) && plain(run.artifacts[name]) ? run.artifacts[name] : null);
const runFacts = (c, r) => ({
  channel: c.channel, workspaceId: c.workspaceId, run: r.run, session: r.session ?? null,
  openedAt: r.openedAt ?? null, sealedAt: r.sealedAt ?? null,
});

// the latest run the module's card reads: each accepted channel's newest run, the greatest run id among them
export function latestOf(listing, module) {
  const m = moduleOf(module);
  if (!m) return null;
  let best = null;
  for (const c of channelsOf(listing)) {
    if (!accepts(m, c)) continue;
    const r = runsIn(c)[0];
    if (r && (!best || r.run > best.r.run)) best = { c, r };
  }
  if (!best) return null;
  const a = artifactOf(best.r, m.name);
  const artifact = a && {
    status: a.status ?? null, missingSources: Array.isArray(a.missingSources) ? a.missingSources : [],
    headline: plain(a.headline) ? a.headline : {}, marketRun: a.marketRun ?? null,
  };
  return { ...runFacts(best.c, best.r), artifact };
}

// an OK artifact's chip words: its headline fields read for the module, a malformed field a 0 or left out, the
// module's title when nothing is left
export function headlineWords(module, headline) {
  const m = moduleOf(module);
  const h = plain(headline) ? headline : {};
  const joined = (...words) => words.filter(w => typeof w === 'string' && w !== '').join(' · ');
  let words = '';
  if (module === 'environment') words = joined(str(h.index_state), str(h.liquidity_state));
  else if (module === 'sentiment') words = joined(str(h.state), str(h.money_effect), str(h.freeze_type));
  else if (module === 'theme') words = joined(countWord(count(h.mainline_candidates), 'candidate'), str(h.theme_stage), str(h.rotation));
  else if (module === 'leader') {
    const n = count(h.leader_candidates);
    const flag = Array.isArray(h.top_pattern_flags) ? str(h.top_pattern_flags[0]) : null;
    words = n === 0 ? 'no candidate' : joined(countWord(n, 'candidate'), flag === 'NONE' ? null : flag);
  } else if (module === 'mode') words = str(h.mode) ? joined(h.mode, plain(h.expectation) ? 'card frozen' : null) : '';
  else if (module === 'counterevidence') words = countWord(count(h.items), 'item');
  return words || (m ? m.title : '');
}

const QUIET = new Set(['no candidate', 'WAIT', '0 items']);

// an artifact's words: its headline words, or `not evaluable` with the sources it missed
function artifactWords(module, a) {
  if (a.status !== 'NOT_EVALUABLE') return { words: headlineWords(module, a.headline), tone: null };
  const missing = (Array.isArray(a.missingSources) ? a.missingSources : []).filter(s => typeof s === 'string');
  return { words: ['not evaluable', ...missing].join(' · '), tone: 'warn' };
}

// the card's chip (spec §5.1): the latest run's artifact read for the module, grey when the rows are not mounted
export function chipOf(listing, module, mounted = true) {
  const m = moduleOf(module);
  const latest = latestOf(listing, module);
  let chip;
  if (!m || !latest) chip = { text: 'no run yet', tone: 'grey' };
  else if (!latest.artifact) chip = { text: 'not run', tone: 'grey' };
  else {
    const { words, tone } = artifactWords(module, latest.artifact);
    const text = m.channels === 'market' ? words : `${latest.channel} · ${words}`;
    chip = { text, tone: tone ?? (QUIET.has(words) ? 'grey' : 'ok') };
  }
  return mounted === false ? { ...chip, tone: 'grey' } : chip;
}

// Discover's Research shelf: the six cards, always, the listing only filling their chips
export function researchItems(listing, mounted) {
  return MODULES.map(m => ({
    id: `module:${m.name}`, shelf: 'research', kind: 'Module', name: m.title, line: m.subtitle,
    meta: `${m.role} · ${m.channelWords}`, mark: { type: 'glyph', icon: m.icon },
    chip: chipOf(listing, m.name, mounted), dim: mounted === false, source: m,
  }));
}

// the module page's runs: every run of an accepted channel holding the artifact, newest first, at most RUNS_SHOWN
export function runsOf(listing, module) {
  const m = moduleOf(module);
  if (!m) return [];
  const rows = [];
  for (const c of channelsOf(listing)) {
    if (!accepts(m, c)) continue;
    for (const r of runsIn(c)) {
      const a = artifactOf(r, m.name);
      if (a) rows.push({ ...runFacts(c, r), status: a.status ?? null, words: artifactWords(m.name, a).words });
    }
  }
  return rows.sort(newer).slice(0, RUNS_SHOWN);
}

// the module page (spec §5.3): the chip, the latest run, the runs, and the Reads, Writes and Runs on boxes
export function pageOf(listing, module, mounted) {
  const m = moduleOf(module);
  if (!m) return null;
  return {
    module: m, chip: chipOf(listing, module, mounted), latest: latestOf(listing, module), rows: runsOf(listing, module),
    kv: {
      reads: [['Freezes', m.freezes], ['Artifacts', m.artifacts], ['Channel', m.channelWords]],
      writes: [['File', m.file], ['Headline', m.headline.join(' · ')], ['Under', `strategies/${DIR_CHANNEL[m.channels]}/analysis/<run>/`]],
      runsOn: [['Role', m.role], ['Route', m.route], ['Budget', BUDGET]],
    },
  };
}
