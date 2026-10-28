// face/client/js/host/run-sheet-view.js — a module card's Run sheet (module cards spec §4 G5, G11–G16, G18,
// §5.4–§5.5, Appendix B): the slice's first value, the render model with each field's options and greying, the
// Stocks check, the conversation's title and the Chinese message to Gravit — from /data/modules.json. Pure. Every wire
// string passes through as data for the view to escape.
import { moduleOf, latestOf, headlineWords } from './modules-view.js';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const channelsOf = listing => (Array.isArray(listing?.channels) ? listing.channels.filter(plain) : []);
const runsIn = c => (Array.isArray(c?.runs) ? c.runs.filter(r => plain(r) && typeof r.run === 'string') : []);
const has = (run, name) => !!run && plain(run.artifacts) && plain(run.artifacts[name]);
const frozenOf = run => (Array.isArray(run?.frozen) ? run.frozen.filter(s => typeof s === 'string') : []);
// a run's date: its session once sealed, the date of opened_at while open (spec G24)
const dateOf = run => (typeof run?.session === 'string' ? run.session
  : typeof run?.openedAt === 'string' ? run.openedAt.slice(0, 10) : null);
const pad = n => String(n).padStart(2, '0');

const MARKET = 'cn-market';
const MARKET_MODULES = ['environment', 'sentiment', 'theme'];
const MAX_CODES = 4;
const CODE = /^(sh60|sz00)\d{4}$/;
const CITES_SHOWN = 2;
const STOCKS_HINT = "optional · 1–4 main-board codes, sh60… or sz00…; empty: Gravit picks from the cited run's mainline members and pool; a code outside them is REFERENCE at the contract";
const STALE = 'run no longer the latest';
const UNREAD = 'the modules listing could not be read';

// Appendix B, one constant per line; the slots in braces
const T_MARKET_LATEST = '请只跑 Lunhui 的 {module} 模块：频道 cn-market，运行 {run}（已有运行，不要再冻结）。';
const T_MARKET_NEW = '请只跑 Lunhui 的 {module} 模块：频道 cn-market，开新运行——先按 lunhui:run 第 1 步冻结整套（index、limit-up、boards），再只写 {module}。';
const T_LEADER_NEW = '请只跑 Lunhui 的 leader 模块：策略 {strategy}，开新运行，引用 cn-market 运行 {market_run}；股票 {codes}。';
const T_LEADER_CODES_NONE = '由你从该市场运行的主线成分股与涨停池里选 1–4 只主板个股';
const T_LEADER_LATEST = '请只跑 Lunhui 的 leader 模块：策略 {strategy}，运行 {run}（已有运行），引用 cn-market 运行 {market_run}。';
const T_REVIEW_MARKET = '请只跑 Lunhui 的 counterevidence 模块：频道 cn-market，运行 {run}（已有运行）。';
const T_REVIEW_STRATEGY = '请只跑 Lunhui 的 counterevidence 模块：策略 {strategy}，运行 {run}（已有运行），引用 cn-market 运行 {market_run}。';
const T_MODE = '请只跑 Lunhui 的 mode 模块：策略 {strategy}，运行 {run}（已有运行），引用 cn-market 运行 {market_run}。';
const T_NOTE = '\n备注：{note}';

const fill = (template, slots) => template.replace(/\{(\w+)\}/g, (_, k) => String(slots[k]));
const channelNamed = (listing, name) => channelsOf(listing).find(c => c.channel === name) ?? null;
const latestIn = (listing, name) => runsIn(channelNamed(listing, name))[0] ?? null;

// Where (G13): cn-market alone for a market card, the strategies for Leader and Mode, both for Counterevidence
function whereOptions(listing, m) {
  const markets = channelsOf(listing).filter(c => c.kind === 'market');
  const strategies = channelsOf(listing).filter(c => c.kind === 'strategy');
  const list = m.channels === 'market' ? markets : m.channels === 'strategy' ? strategies : [...markets, ...strategies];
  return list.map(c => ({ value: c.channel, label: c.channel }));
}

const latestLabel = run => `Latest run · ${run.run} · session ${dateOf(run) ?? 'unknown'}`;
const frozenWords = run => `frozen: ${frozenOf(run).join(' · ') || 'nothing yet'}`;
// a stale option (G15, the controller's stamp) keeps `enabled` as the artifact rules say, so it can be picked again to
// re-stamp the run; its reason is the stale one while the newest run would be selectable, else the artifact rule's own
const option = (id, label, detail, reason, stale = false) => ({ id, label, detail, enabled: reason === null, reason: stale && reason === null ? STALE : reason, stale });

// two titles as one phrase: `Theme`, `Sentiment and Theme`
const titlesWords = names => names.map(n => moduleOf(n).title).join(' and ');

// the Latest run option's reason, null when it is open to run: the module's prerequisites on the run (G1, G15)
function latestReason(m, channel, run) {
  if (MARKET_MODULES.includes(m.name)) return has(run, m.name) ? `${m.name} already there` : null;
  if (m.name === 'leader') return has(run, 'leader') ? 'leader already there' : null;
  if (m.name === 'mode') {
    if (has(run, 'mode')) return 'mode already registered on this run';
    return has(run, 'leader') && has(run, 'counterevidence') ? null : 'needs Leader, then Counterevidence, on this run';
  }
  if (has(run, 'counterevidence')) return 'review already there';
  if (channel?.kind === 'market') return MARKET_MODULES.some(n => has(run, n)) ? null : 'no market artifact yet on this run';
  return has(run, 'leader') ? null : 'needs Leader on this run';
}

// the Latest run option's detail: what the run froze, or what the review would cover (G15)
function latestDetail(m, channel, run) {
  if (m.name !== 'counterevidence') return frozenWords(run);
  if (channel?.kind === 'market') {
    const present = MARKET_MODULES.filter(n => has(run, n));
    if (present.length === 0) return null;
    const missing = MARKET_MODULES.filter(n => !has(run, n));
    return `reviews: ${present.join(' · ')}${missing.length ? ` — ${titlesWords(missing)} not run on this run` : ''}`;
  }
  const present = ['leader', 'mode'].filter(n => has(run, n));
  const line = present.length ? `reviews: ${present.join(' · ')}` : null;
  if (!has(run, 'mode')) return line;
  return [line, 'warning: mode already registered on this run — this review would go unanswered'].filter(Boolean).join(' — ');
}

// On (G1, G14, G15): Latest run from the channel's newest run, New run on the three market cards and Leader
function onOptions(listing, m, sheet) {
  const channel = channelNamed(listing, sheet.where);
  const run = runsIn(channel)[0] ?? null;
  const options = [];
  if (run) {
    const stale = sheet.on === 'latest' && sheet.run !== run.run;
    options.push(option('latest', latestLabel(run), latestDetail(m, channel, run), latestReason(m, channel, run), stale));
  } else if (m.name === 'mode' || m.name === 'counterevidence') {
    options.push(option('latest', 'Latest run', null, 'no run yet'));
  }
  if (MARKET_MODULES.includes(m.name)) {
    options.push(option('new', 'New run', `Gravit freezes index · limit-up · boards, then the CN market analyst writes ${m.title} alone; the other two market modules stay not run on that run until run from their cards`, null));
  } else if (m.name === 'leader') {
    options.push(option('new', 'New run', 'Gravit freezes quotes for the stocks, which opens the run', null));
  }
  return options;
}

// the two newest sealed cn-market runs a Leader can cite (G12), newest first
const sealedMarketRuns = listing => runsIn(channelNamed(listing, MARKET)).filter(r => typeof r.sealedAt === 'string')
  .sort((a, b) => (a.run > b.run ? -1 : a.run < b.run ? 1 : 0)).slice(0, CITES_SHOWN);

function themeWords(run) {
  if (!has(run, 'theme')) return 'not run';
  const a = run.artifacts.theme;
  return a.status === 'OK' ? headlineWords('theme', a.headline) : 'not evaluable';
}

// Cites: Leader picks among the sealed market runs; Mode and a strategy's review read the run's leader's market run
function citesOf(listing, m, sheet) {
  const channel = channelNamed(listing, sheet.where);
  if (m.name === 'leader') {
    const runs = sealedMarketRuns(listing);
    const options = runs.map(r => ({
      value: r.run,
      label: `${r.run} · session ${dateOf(r) ?? 'unknown'} · ${frozenWords(r)} · theme ${themeWords(r)}`,
      warning: has(r, 'sentiment') && has(r, 'theme') ? null : 'Mode and Counterevidence on this cite would be not evaluable',
    }));
    const chosen = runs.find(r => r.run === sheet.cites) ?? null;
    const notEvaluable = chosen && has(chosen, 'theme') && chosen.artifacts.theme.status === 'NOT_EVALUABLE';
    return {
      readOnly: false, options, value: chosen ? chosen.run : null,
      line: notEvaluable ? 'theme not evaluable: the pick comes from the limit-up pool alone' : null,
    };
  }
  if (m.name === 'mode' || (m.name === 'counterevidence' && channel?.kind === 'strategy')) {
    const run = runsIn(channel)[0] ?? null;
    const cited = has(run, 'leader') && typeof run.artifacts.leader.marketRun === 'string' ? run.artifacts.leader.marketRun : null;
    return {
      readOnly: true, options: cited ? [{ value: cited, label: `${cited} · the run's leader cites it`, warning: null }] : [],
      value: cited, line: null,
    };
  }
  return null;
}

// Theme's source line (G16): how many of cn-market's listed sealed runs froze no boards — an open run may not have frozen yet
function sourceOf(listing, m) {
  if (m.name !== 'theme') return null;
  const runs = runsIn(channelNamed(listing, MARKET)).filter(r => typeof r.sealedAt === 'string');
  const missing = runs.filter(r => !frozenOf(r).includes('boards')).length;
  if (runs.length === 0 || missing === 0) return null;
  if (missing < runs.length) return `boards missing in ${missing} of the last ${runs.length} runs`;
  return runs.length === 1 ? 'boards missing in the last run' : `boards missing in the last ${runs.length} runs`;
}

/** The Stocks field (G11): main-board codes by shape alone, lower-cased, duplicates folded, at most four. */
export function stocksOf(text) {
  const tokens = String(text ?? '').split(/[\s,，、]+/).filter(t => t !== '').map(t => t.toLowerCase());
  const bad = tokens.find(t => !CODE.test(t));
  if (bad !== undefined) return { codes: [], error: `not a main-board code: ${bad}` };
  const codes = [...new Set(tokens)];
  if (codes.length > MAX_CODES) return { codes: [], error: `at most ${MAX_CODES} codes` };
  return { codes, error: null };
}

/** The slice's first value for a card, or null for an unknown module; `channel`, when named, is Where (a market card's
 *  stays cn-market) and the other picks are that channel's. */
export function newSheet(listing, module, channel) {
  const m = moduleOf(module);
  if (!m) return null;
  const firstStrategy = channelsOf(listing).find(c => c.kind === 'strategy')?.channel ?? null;
  const latest = latestOf(listing, module)?.channel ?? null;
  const where = m.channels === 'market' ? MARKET : typeof channel === 'string' ? channel
    : m.channels === 'strategy' ? latest ?? firstStrategy : latest ?? MARKET;
  const run = latestIn(listing, where)?.run ?? null;
  const options = onOptions(listing, m, { where, on: null, run });
  const on = options.find(o => o.id === 'latest' && o.enabled) ? 'latest' : options.find(o => o.id === 'new') ? 'new' : null;
  const cites = m.name === 'leader' ? sealedMarketRuns(listing)[0]?.run ?? null : null;
  return { module: m.name, where, on, run, cites, stocks: '', note: '', said: null };
}

/** The conversation's title, `<Title> · MM-DD`: for a Latest run the stamped run's date while it is listed, else the
 *  channel's newest; the browser's date otherwise. */
export function titleOf(listing, sheet, now) {
  const m = moduleOf(sheet?.module);
  if (!m) return '';
  const stamped = runsIn(channelNamed(listing, sheet.where)).find(r => r.run === sheet.run) ?? null;
  const date = sheet.on === 'latest' ? dateOf(stamped ?? latestIn(listing, sheet.where)) : null;
  if (date) return `${m.title} · ${date.slice(5, 10)}`;
  const d = new Date(now);
  return `${m.title} · ${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The sheet's render model; `now` dates a New run's title. */
export function sheetOf(listing, sheet, now = Date.now()) {
  const m = moduleOf(sheet?.module);
  if (!m) return null;
  const whereOpts = whereOptions(listing, m);
  const where = whereOpts.some(o => o.value === sheet.where) ? sheet.where : null;
  const onOpts = where ? onOptions(listing, m, sheet) : [];
  const chosen = onOpts.find(o => o.id === sheet.on) ?? null;
  const cites = where ? citesOf(listing, m, sheet) : null;
  // Stocks on a Leader's New run alone: a Latest run's message has no codes slot; the slice keeps the text meanwhile
  const stocks = m.name === 'leader' && sheet.on !== 'latest' ? { value: sheet.stocks ?? '', error: stocksOf(sheet.stocks).error, hint: STOCKS_HINT } : null;

  let blocker = null;
  if (!plain(listing)) blocker = UNREAD;
  else if (!where) blocker = 'choose where to run';
  else if (!chosen) blocker = 'choose a run';
  else if (chosen.stale || !chosen.enabled) blocker = chosen.reason;
  else if (cites && !cites.readOnly && !cites.value) blocker = 'choose a market run to cite';
  else if (cites && cites.readOnly && !cites.value) blocker = "the run's leader names no market run";
  else if (stocks?.error) blocker = stocks.error;

  return {
    title: `Run ${m.title}`,
    where: { options: whereOpts, value: where, fixed: m.channels === 'market' },
    on: { options: onOpts, value: chosen ? chosen.id : null },
    cites, stocks, source: sourceOf(listing, m), note: { value: sheet.note ?? '' },
    via: `Gravit in ${where ?? '…'} → ${m.role}, ${m.name} alone`,
    writes: `${m.file} · a conversation "${titleOf(listing, sheet, now)}"`,
    canRun: blocker === null, blocker,
  };
}

/** The message to Gravit (Appendix B) with the slots filled, the Note on a last line; null without a module or On. */
export function messageOf(listing, sheet) {
  const m = moduleOf(sheet?.module);
  if (!m || (sheet.on !== 'latest' && sheet.on !== 'new')) return null;
  const channel = channelNamed(listing, sheet.where);
  const run = runsIn(channel)[0] ?? null;
  const leaderCite = has(run, 'leader') ? run.artifacts.leader.marketRun : null;
  const slots = { module: m.name, strategy: sheet.where, run: run?.run, market_run: leaderCite };
  let text;
  if (MARKET_MODULES.includes(m.name)) text = fill(sheet.on === 'new' ? T_MARKET_NEW : T_MARKET_LATEST, slots);
  else if (m.name === 'leader') {
    const codes = stocksOf(sheet.stocks).codes;
    const leaderSlots = { ...slots, market_run: sheet.cites, codes: codes.length ? codes.join('、') : T_LEADER_CODES_NONE };
    text = fill(sheet.on === 'new' ? T_LEADER_NEW : T_LEADER_LATEST, leaderSlots);
  } else if (m.name === 'mode') text = fill(T_MODE, slots);
  else text = fill(channel?.kind === 'market' ? T_REVIEW_MARKET : T_REVIEW_STRATEGY, slots);
  const note = typeof sheet.note === 'string' ? sheet.note.trim() : '';
  return note ? text + fill(T_NOTE, { note }) : text;
}
