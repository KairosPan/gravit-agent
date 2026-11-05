// face/client/js/host/run-sheet-view.js — a module card's Run sheet (module cards spec §4 G5, G11–G16, G18,
// §5.4–§5.5, Appendix B): the slice's first value, the render model with each field's options and greying, the
// Stocks check, the conversation's title and the Chinese message to Gravit — from /data/modules.json. Pure. Every wire
// string passes through as data for the view to escape.
import { moduleOf, latestOf, headlineWords } from './modules-view.js';
import { t, tn, said, sayOf } from '../i18n/words.js';

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

const latestLabel = run => t('runSheet.on.latestRun', { run: run.run, date: dateOf(run) ?? t('runSheet.unknown') });
const frozenWords = run => t('runSheet.frozen', { what: frozenOf(run).join(' · ') || t('runSheet.nothingYet') });
// a stale option (G15, the controller's stamp) keeps `enabled` as the artifact rules say, so it can be picked again to
// re-stamp the run; its reason is the stale one while the newest run would be selectable, else the artifact rule's own.
// `why` is the reason as a said (sheetOf's blockedBy, which the Run sheet's line keeps), `reason` its words now
const option = (id, label, detail, why, stale = false) => {
  const kept = stale && why === null ? said('runSheet.stale') : why;
  return { id, label, detail, enabled: why === null, reason: kept === null ? null : sayOf(kept), why: kept, stale };
};

// two titles as one phrase: `Theme`, `Sentiment and Theme`
const titlesWords = names => names.map(n => moduleOf(n).title).reduce((a, b) => t('runSheet.both', { a, b }));

// the Latest run option's reason, null when it is open to run: the module's prerequisites on the run (G1, G15)
function latestReason(m, channel, run) {
  if (MARKET_MODULES.includes(m.name)) return has(run, m.name) ? said('runSheet.reason.there', { module: m.name }) : null;
  if (m.name === 'leader') return has(run, 'leader') ? said('runSheet.reason.there', { module: 'leader' }) : null;
  if (m.name === 'mode') {
    if (has(run, 'mode')) return said('runSheet.reason.modeThere');
    return has(run, 'leader') && has(run, 'counterevidence') ? null : said('runSheet.reason.needsBoth');
  }
  if (has(run, 'counterevidence')) return said('runSheet.reason.reviewThere');
  if (channel?.kind === 'market') return MARKET_MODULES.some(n => has(run, n)) ? null : said('runSheet.reason.noMarket');
  return has(run, 'leader') ? null : said('runSheet.reason.needsLeader');
}

// the Latest run option's detail: what the run froze, or what the review would cover (G15)
function latestDetail(m, channel, run) {
  if (m.name !== 'counterevidence') return frozenWords(run);
  if (channel?.kind === 'market') {
    const present = MARKET_MODULES.filter(n => has(run, n));
    if (present.length === 0) return null;
    const missing = MARKET_MODULES.filter(n => !has(run, n));
    const reviews = t('runSheet.reviews', { modules: present.join(' · ') });
    return missing.length ? t('runSheet.warned', { line: reviews, warning: t('runSheet.notRunHere', { titles: titlesWords(missing) }) }) : reviews;
  }
  const present = ['leader', 'mode'].filter(n => has(run, n));
  const line = present.length ? t('runSheet.reviews', { modules: present.join(' · ') }) : null;
  if (!has(run, 'mode')) return line;
  return line ? t('runSheet.warned', { line, warning: t('runSheet.unanswered') }) : t('runSheet.unanswered');
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
    options.push(option('latest', t('runSheet.on.latest'), null, said('modules.chip.noRun')));
  }
  if (MARKET_MODULES.includes(m.name)) {
    options.push(option('new', t('runSheet.on.new'), t('runSheet.on.newMarket', { title: m.title }), null));
  } else if (m.name === 'leader') {
    options.push(option('new', t('runSheet.on.new'), t('runSheet.on.newLeader'), null));
  }
  return options;
}

// the two newest sealed cn-market runs a Leader can cite (G12), newest first
const sealedMarketRuns = listing => runsIn(channelNamed(listing, MARKET)).filter(r => typeof r.sealedAt === 'string')
  .sort((a, b) => (a.run > b.run ? -1 : a.run < b.run ? 1 : 0)).slice(0, CITES_SHOWN);

function themeWords(run) {
  if (!has(run, 'theme')) return t('modules.chip.notRun');
  const a = run.artifacts.theme;
  return a.status === 'OK' ? headlineWords('theme', a.headline) : t('modules.notEvaluable'); // en-kept: the artifact's status, matched
}

// Cites: Leader picks among the sealed market runs; Mode and a strategy's review read the run's leader's market run
function citesOf(listing, m, sheet) {
  const channel = channelNamed(listing, sheet.where);
  if (m.name === 'leader') {
    const runs = sealedMarketRuns(listing);
    const options = runs.map(r => ({
      value: r.run,
      label: t('runSheet.cite', { run: r.run, date: dateOf(r) ?? t('runSheet.unknown'), frozen: frozenWords(r), theme: themeWords(r) }),
      warning: has(r, 'sentiment') && has(r, 'theme') ? null : t('runSheet.citeWarning'),
    }));
    const chosen = runs.find(r => r.run === sheet.cites) ?? null;
    const notEvaluable = chosen && has(chosen, 'theme') && chosen.artifacts.theme.status === 'NOT_EVALUABLE';
    return {
      readOnly: false, options, value: chosen ? chosen.run : null,
      line: notEvaluable ? t('runSheet.themeNotEvaluable') : null,
    };
  }
  if (m.name === 'mode' || (m.name === 'counterevidence' && channel?.kind === 'strategy')) {
    const run = runsIn(channel)[0] ?? null;
    const cited = has(run, 'leader') && typeof run.artifacts.leader.marketRun === 'string' ? run.artifacts.leader.marketRun : null;
    return {
      readOnly: true, options: cited ? [{ value: cited, label: t('runSheet.citedByLeader', { run: cited }), warning: null }] : [],
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
  if (missing < runs.length) return t('runSheet.source.some', { missing, n: runs.length });
  return tn('runSheet.source.all', runs.length);
}

// what is wrong with the Stocks typed, as a said (the line Run leaves keeps it), or null: a token that is no main-board code,
// or more codes than a run takes
function stocksWhy(tokens) {
  const bad = tokens.find(tok => !CODE.test(tok));
  if (bad !== undefined) return said('runSheet.stocks.notCode', { code: bad });
  return new Set(tokens).size > MAX_CODES ? said('runSheet.stocks.atMost', { n: MAX_CODES }) : null;
}
const tokensOf = text => String(text ?? '').split(/[\s,，、]+/).filter(tok => tok !== '').map(tok => tok.toLowerCase());

/** The Stocks field (G11): main-board codes by shape alone, lower-cased, duplicates folded, at most four. */
export function stocksOf(text) {
  const tokens = tokensOf(text);
  const why = stocksWhy(tokens);
  return why ? { codes: [], error: sayOf(why) } : { codes: [...new Set(tokens)], error: null };
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
  const typed = m.name === 'leader' && sheet.on !== 'latest' ? stocksWhy(tokensOf(sheet.stocks)) : undefined;
  const stocks = typed !== undefined ? { value: sheet.stocks ?? '', error: typed === null ? null : sayOf(typed), hint: t('runSheet.stocks.hint') } : null;

  // what blocks Run, as a said (the line Run leaves is kept) and in words now (the button's title)
  let blockedBy = null;
  if (!plain(listing)) blockedBy = said('runSheet.unread');
  else if (!where) blockedBy = said('runSheet.chooseWhere');
  else if (!chosen) blockedBy = said('runSheet.chooseRun');
  else if (chosen.stale || !chosen.enabled) blockedBy = chosen.why;
  else if (cites && !cites.readOnly && !cites.value) blockedBy = said('runSheet.chooseCite');
  else if (cites && cites.readOnly && !cites.value) blockedBy = said('runSheet.noCite');
  else if (typed) blockedBy = typed;
  const blocker = blockedBy === null ? null : sayOf(blockedBy);

  return {
    title: t('runSheet.title', { title: m.title }),
    where: { options: whereOpts, value: where, fixed: m.channels === 'market' },
    on: { options: onOpts, value: chosen ? chosen.id : null },
    cites, stocks, source: sourceOf(listing, m), note: { value: sheet.note ?? '' },
    via: t('runSheet.via', { where: where ?? '…', role: m.role, module: m.name }),
    writes: t('runSheet.writes', { file: m.file, title: `"${titleOf(listing, sheet, now)}"` }),
    canRun: blocker === null, blocker, blockedBy,
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
