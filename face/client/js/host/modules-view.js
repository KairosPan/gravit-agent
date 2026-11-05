// face/client/js/host/modules-view.js — the six Lunhui modules as Discover's Research cards (module cards spec §5.1,
// §5.3, Appendix A): the static table the cards share with the server, kept in step with face/src/channels.ts
// MODULE_HEADLINES, face/plugins/lunhui/lib/modules.mjs and the roles by tests/lunhui-modules-table.test.ts, joined with
// GET /data/modules.json into chips, the shelf's items and a module page's rows. Pure. Every wire string passes through
// as data for the view to escape; the manuscript is cited by paragraph id only.
import { t, tn } from '../i18n/words.js';
import { itemsWord } from './runs-view.js';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : null);
const count = v => (Array.isArray(v) ? v.length : 0);

const ROUTE = 'deepseek-official/deepseek-flash';
const RUNS_SHOWN = 24;
// the roles' own names, as roles/*/role.yml writes them (tests/lunhui-modules-table.test.ts)
const [MARKET_ANALYST, STOCK_ANALYST, REVIEWER] = [['CN market analyst', 'cn-market-analyst'], ['CN stock analyst', 'cn-stock-analyst'], ['CN reviewer', 'cn-reviewer']]; // en-kept: the roles' names
// the channels a module reads, in words: cn-market is the channel's own name
function channelWordsOf(channels) {
  if (channels === 'market') return 'cn-market';
  return channels === 'strategy' ? t('modules.channels.strategy') : t('modules.channels.either');
}
// the directory a module writes under: strategies/<channel>/analysis/<run>/, the channel named as far as it is known
const DIR_CHANNEL = { market: 'cn-market', strategy: '<strategy>', either: '<channel>' };

const pairRows = pairs => pairs.map(([label, text]) => ({ label, text }));

// A.2: the design's mapping of the text's stages onto the seven labels, not the text's own; the text's stages as it names them
const sentimentLegend = () => ({
  title: t('modules.sentiment.legend'),
  rows: pairRows([
    ['CHAOS', `混沌期 / 情绪冰点 P0161, ${t('modules.sentiment.retreatLate')} P0372`],
    ['IGNITION', '修复启动 P0165, 拐点 P0179, 情绪回暖 P0185, 题材启动日 P0191'],
    ['EXPANSION', '题材启动次日 P0202, 题材发酵 P0208, 主升 P0198, P0213'],
    ['CLIMAX', '加速高潮 P0253, P0337–P0352'],
    ['RETREAT', '分化弱分歧 P0243, 大分歧 P0258, 周期转变信号 P0291, 退潮期 P0372, 方向切换 P0382'],
    ['REPAIR', '修复 P0268, P0294, 转点 P0283, 超跌反抽 P0391'],
    ['UNKNOWN', t('modules.sentiment.disagree')],
  ]),
});

// A.4: top_pattern_flags as contracts/leader.mjs words them, in English
const leaderLegend = () => ({
  title: t('modules.leader.legend'),
  rows: pairRows([
    ['ACCELERATING', t('modules.leader.accelerating')],
    ['DIVERGENCE', t('modules.leader.divergence')],
    ['BROKEN_STREAK', t('modules.leader.brokenStreak')],
    ['HIGH_POSITION', t('modules.leader.highPosition')],
    ['FIRST_BOARD', t('modules.leader.firstBoard')],
    ['NONE', t('modules.leader.none')],
  ]),
});

// A.5: the preconditions as contracts/mode.mjs names them, each with the class of evidence it cites when met
function modeLegend() {
  const theme = t('modules.mode.themeClass');
  const candidate = t('modules.mode.candidateClass');
  return {
    title: t('modules.mode.legend'),
    rows: pairRows([
      ['theme_gate', `S01: ${theme}`],
      ['candidate_before_divergence', `S01: ${candidate}`],
      ['theme_not_falsified', `S01: ${theme}`],
      ['negative_tail_not_widening', `S01: ${t('modules.mode.negativeTail')}`],
      ['minute_confirmation', `S01, S02: ${t('modules.mode.minute')}`],
      ['old_theme_retreat', `S02: ${t('modules.mode.oldTheme')}`],
      ['catalyst', `S02: ${t('modules.mode.catalyst')}`],
      ['candidates_pooled', `S02: ${candidate}`],
    ]),
  };
}

// A.6: the ten rulings (strategy-spec §7) by topic, each with A.6's paragraph ids, then the five kinds of an item
const counterevidenceLegend = () => ({
  title: t('modules.counterevidence.legend'),
  rows: pairRows([
    [t('modules.counterevidence.ruling1'), 'P0016 vs P0574, P0782, P0855'],
    [t('modules.counterevidence.ruling2'), 'P0536 vs P0534, P0454'],
    [t('modules.counterevidence.ruling3'), 'P0755–P0757'],
    [t('modules.counterevidence.ruling4'), 'P0780–P0784 vs P0822–P0823, P1272'],
    [t('modules.counterevidence.ruling5'), 'P0403 vs P0285–P0288'],
    [t('modules.counterevidence.ruling6'), 'P0874, P0888, P0819'],
    [t('modules.counterevidence.ruling7'), 'P0337–P0348'],
    [t('modules.counterevidence.ruling8'), 'P0205–P0217 vs P1110'],
    [t('modules.counterevidence.ruling9'), 'P0524, P0744–P0745, P1093–P1094, P1525'],
    [t('modules.counterevidence.ruling10'), 'P0068, P1157, P1694–P1697'],
    ['CONTRADICTS', t('modules.counterevidence.contradicts')],
    ['MISSING_EVIDENCE', t('modules.counterevidence.missingEvidence')],
    ['STALE', t('modules.counterevidence.stale')],
    ['RULING_CONFLICT', t('modules.counterevidence.rulingConflict')],
    ['OVERREACH', t('modules.counterevidence.overreach')],
  ]),
});

// each module's words, read when asked: its title, and what the page's Reads box says it reads — `freezes` and
// `artifacts`, none where it reads nothing of a kind
const WORDS = {
  environment: () => [t('modules.environment.title'), t('modules.environment.freezes'), t('modules.reads.none')],
  sentiment: () => [t('modules.sentiment.title'), t('modules.sentiment.freezes'), t('modules.reads.none')],
  theme: () => [t('modules.theme.title'), t('modules.theme.freezes'), t('modules.reads.none')],
  leader: () => [t('modules.leader.title'), t('modules.leader.freezes'), t('modules.leader.artifacts')],
  mode: () => [t('modules.mode.title'), t('modules.reads.none'), t('modules.mode.artifacts')],
  counterevidence: () => [t('modules.counterevidence.title'), t('modules.reads.none'), t('modules.counterevidence.artifacts')],
};
const LEGENDS = { sentiment: sentimentLegend, leader: leaderLegend, mode: modeLegend, counterevidence: counterevidenceLegend };

// a module's codes are fixed; its words (title, freezes, artifacts, channelWords, legend) are getters, read from the
// table when drawn
const entry = (name, subtitle, [role, roleId], channels, headline, icon) => Object.freeze({
  name, subtitle, role, roleId, route: ROUTE, channels, file: `${name}.json`,
  headline: Object.freeze(headline), tools: Object.freeze([`lunhui_read_${name}_context`, `lunhui_submit_${name}`]), icon,
  get title() { return WORDS[name]()[0]; },
  get freezes() { return WORDS[name]()[1]; },
  get artifacts() { return WORDS[name]()[2]; },
  get channelWords() { return channelWordsOf(channels); },
  get legend() { return Object.hasOwn(LEGENDS, name) ? LEGENDS[name]() : null; },
});

export const MODULES = Object.freeze([
  entry('environment', '环境与大周期 · index · liquidity · cycle anchor', MARKET_ANALYST, 'market', // en-kept: the module's Chinese sub-title
    ['index_state', 'liquidity_state', 'cycle_anchor'], 'layers'),
  entry('sentiment', '情绪周期 · state · money effect · 冰点', MARKET_ANALYST, 'market', // en-kept: the module's Chinese sub-title
    ['state', 'money_effect', 'freeze_type'], 'pulse'),
  entry('theme', '题材与轮动 · mainline · stage · rotation', MARKET_ANALYST, 'market',
    ['mainline_candidates', 'theme_stage', 'rotation'], 'flame'),
  entry('leader', '龙头与个股地位 · candidates · 顺位 · pattern flags', STOCK_ANALYST, 'strategy', // en-kept: the module's Chinese sub-title
    ['leader_candidates', 'top_pattern_flags'], 'podium'),
  entry('mode', '模式选择与预期 · mode · preconditions · expectation', STOCK_ANALYST, 'strategy',
    ['mode', 'preconditions', 'research_only_matches', 'expectation', 'expectation_review'], 'switch'),
  entry('counterevidence', '反证 · items against the accepted artifacts', REVIEWER, 'either', // en-kept: the module's Chinese sub-title
    ['items'], 'shield'),
]);

export const MODULE_NAMES = new Set(MODULES.map(m => m.name));

export const moduleOf = name => MODULES.find(m => m.name === name) ?? null;

// the channels a module reads: a market module the channels the listing marks kind market, a strategy module those it
// marks kind strategy, an either module all
const accepts = (m, c) => m.channels === 'either' || c?.kind === m.channels;
const channelsOf = listing => (Array.isArray(listing?.channels) ? listing.channels.filter(plain) : []);
const runsIn = c => (Array.isArray(c.runs) ? c.runs.filter(r => plain(r) && typeof r.run === 'string') : []);
// run ids open with the UTC second, so string order is time order
const newer = (a, b) => (a.run > b.run ? -1 : a.run < b.run ? 1 : 0);
const artifactOf = (run, name) => (plain(run.artifacts) && plain(run.artifacts[name]) ? run.artifacts[name] : null);
const runFacts = (c, r) => ({
  channel: c.channel, workspaceId: c.workspaceId, run: r.run, session: r.session ?? null,
  openedAt: r.openedAt ?? null, sealedAt: r.sealedAt ?? null, boardsProvider: typeof r.boardsProvider === 'string' ? r.boardsProvider : null,
});

// the theme module's words end with where its boards came from, when Eastmoney's failed and 问财 stood in
export const THS_STAND_IN = '同花顺问财';
export const withSource = (module, boardsProvider, words) =>
  module === 'theme' && boardsProvider === THS_STAND_IN ? `${words} · ${t('modules.boardsThs')}` : words;

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
// module's title when nothing is left; quiet (a grey chip) for no candidate, WAIT and no item
function headlineOf(module, headline) {
  const m = moduleOf(module);
  const h = plain(headline) ? headline : {};
  const joined = (...words) => words.filter(w => typeof w === 'string' && w !== '').join(' · ');
  let words = '';
  let quiet = false;
  if (module === 'environment') words = joined(str(h.index_state), str(h.liquidity_state));
  else if (module === 'sentiment') words = joined(str(h.state), str(h.money_effect), str(h.freeze_type));
  else if (module === 'theme') words = joined(tn('modules.count.candidates', count(h.mainline_candidates)), str(h.theme_stage), str(h.rotation));
  else if (module === 'leader') {
    const n = count(h.leader_candidates);
    const flag = Array.isArray(h.top_pattern_flags) ? str(h.top_pattern_flags[0]) : null;
    quiet = n === 0;
    words = n === 0 ? t('modules.chip.noCandidate') : joined(tn('modules.count.candidates', n), flag === 'NONE' ? null : flag);
  } else if (module === 'mode') words = str(h.mode) ? joined(h.mode, plain(h.expectation) ? t('modules.chip.cardFrozen') : null) : '';
  else if (module === 'counterevidence') {
    quiet = count(h.items) === 0;
    words = itemsWord(count(h.items));
  }
  // WAIT is the mode's own word (or any headline's that reads it alone)
  return { words: words || (m ? m.title : ''), quiet: quiet || words === 'WAIT' };
}
export const headlineWords = (module, headline) => headlineOf(module, headline).words;

// an artifact's words: its headline words, or `not evaluable` with the sources it missed
function artifactWords(module, a) {
  if (a.status !== 'NOT_EVALUABLE') { const h = headlineOf(module, a.headline); return { words: h.words, tone: null, quiet: h.quiet }; }
  const missing = (Array.isArray(a.missingSources) ? a.missingSources : []).filter(s => typeof s === 'string');
  return { words: [t('modules.notEvaluable'), ...missing].join(' · '), tone: 'warn', quiet: false };
}

// a Run this page sent (spec §5.7) is running while its conversation says so, or while the record is younger than a
// minute (the create just happened, the list may not carry the session yet); nothing else is
export const FRESH_MS = 60_000;
export function activeRuns(moduleRuns, conversations, now) {
  const convs = Array.isArray(conversations) ? conversations : [];
  const out = {};
  for (const [module, r] of Object.entries(plain(moduleRuns) ? moduleRuns : {})) {
    if (!plain(r) || typeof r.sessionId !== 'string' || typeof r.title !== 'string' || typeof r.startedAt !== 'number') continue;
    const running = convs.some(c => c?.id === r.sessionId && c.running === true);
    if (running || now - r.startedAt < FRESH_MS) out[module] = { sessionId: r.sessionId, title: r.title };
  }
  return out;
}

// the card's chip (spec §5.1): the latest run's artifact read for the module, grey when the rows are not mounted; while
// a Run of it is running, `Running · <title>` linking to its conversation
export function chipOf(listing, module, mounted = true, active = null) {
  if (active) return { text: t('modules.chip.running', { title: active.title }), tone: 'live', href: `#/messages/${encodeURIComponent(active.sessionId)}` };
  const m = moduleOf(module);
  const latest = latestOf(listing, module);
  let chip;
  if (!m || !latest) chip = { text: t('modules.chip.noRun'), tone: 'grey' };
  else {
    // a strategy or either card names the channel of its newest run, `not run` too
    const pre = m.channels === 'market' ? '' : `${latest.channel} · `;
    if (!latest.artifact) chip = { text: `${pre}${t('modules.chip.notRun')}`, tone: 'grey' };
    else {
      const { words: base, tone, quiet } = artifactWords(module, latest.artifact);
      const words = withSource(module, latest.boardsProvider, base);
      chip = { text: `${pre}${words}`, tone: tone ?? (quiet ? 'grey' : 'ok') };
    }
  }
  return mounted === false ? { ...chip, tone: 'grey' } : chip;
}

// Discover's Research shelf: the six cards, always, the listing only filling their chips
export function researchItems(listing, mounted, actives = {}) {
  const on = plain(actives) ? actives : {};
  return MODULES.map(m => ({
    id: `module:${m.name}`, shelf: 'research', kind: t('discover.kind.module'), name: m.title, line: m.subtitle,
    meta: `${m.role} · ${m.channelWords}`, mark: { type: 'glyph', icon: m.icon },
    chip: chipOf(listing, m.name, mounted, on[m.name] ?? null), dim: mounted === false, running: Boolean(on[m.name]), source: m,
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
      if (a) rows.push({ ...runFacts(c, r), status: a.status ?? null, words: withSource(m.name, r.boardsProvider, artifactWords(m.name, a).words) });
    }
  }
  return rows.sort(newer).slice(0, RUNS_SHOWN);
}

// the module page (spec §5.3): the chip, the latest run, the runs, and the Reads, Writes and Runs on boxes
export function pageOf(listing, module, mounted, actives = {}) {
  const m = moduleOf(module);
  if (!m) return null;
  const active = plain(actives) ? actives[module] ?? null : null;
  return {
    module: m, chip: chipOf(listing, module, mounted, active), running: Boolean(active), latest: latestOf(listing, module), rows: runsOf(listing, module),
    kv: {
      reads: [[t('modules.box.freezes'), m.freezes], [t('modules.box.artifacts'), m.artifacts], [t('modules.box.channel'), m.channelWords]],
      writes: [[t('modules.box.file'), m.file], [t('modules.box.headline'), m.headline.join(' · ')], [t('modules.box.under'), `strategies/${DIR_CHANNEL[m.channels]}/analysis/<run>/`]],
      runsOn: [[t('modules.box.role'), m.role], [t('modules.box.route'), m.route], [t('modules.box.budget'), t('modules.budget')]],
    },
  };
}
