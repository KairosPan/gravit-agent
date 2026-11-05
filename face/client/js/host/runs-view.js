// face/client/js/host/runs-view.js — a channel's Lunhui research runs (modules spec A14, §5.11), shaped from the
// overview's runs, runsOmitted and latestRun. Pure. Every string is the wire's, passed through as data for the view to
// escape; an artifact the server could not read is simply absent, and no run holds one yet before plan 2.
import { t, tn } from '../i18n/words.js';

const scalar = v => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : null);
const ARRAY_SHOWN = 3;

// a count of items, singular for one: 1 item, 2 items
export const itemsWord = n => tn('channel.count.items', n);

// one headline value as a word: a scalar as itself (a fraction to four places), a short list of scalars joined, any
// other list by its length, an object by its field count
export function valueWord(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  if (scalar(v)) return String(v);
  if (Array.isArray(v)) return v.length <= ARRAY_SHOWN && v.every(scalar) ? v.map(valueWord).join(t('common.list.sep')) : itemsWord(v.length);
  if (plain(v)) return tn('channel.count.fields', Object.keys(v).length);
  return '';
}

// a module's chip: its headline values joined, `not evaluable` for a module whose evidence was missing, the
// counterevidence by its items' count, the mode by its mode word alone (its card and review are lines of their own)
function chipText(module, art, status, boardsProvider = null) {
  if (status === 'NOT_EVALUABLE') return t('channel.chip.notEvaluable', { module });
  const h = plain(art.headline) ? art.headline : {};
  if (module === 'counterevidence') return t('channel.chip.module', { module, words: itemsWord(Array.isArray(h.items) ? h.items.length : 0) });
  if (module === 'mode') return typeof h.mode === 'string' ? t('channel.chip.module', { module, words: h.mode }) : module;
  const words = Object.values(h).filter(v => v !== undefined).map(valueWord).filter(w => w !== '');
  const text = words.length ? t('channel.chip.module', { module, words: words.join(' · ') }) : module;
  return module === 'theme' && boardsProvider === '同花顺问财' ? t('modules.chip.withSource', { words: text, source: t('modules.boardsThs') }) : text;
}

function compact(json) {
  try { return JSON.stringify(json); } catch { return ''; }
}

function latestOf(l, rows) {
  if (!plain(l) || typeof l.run !== 'string') return null;
  const arts = plain(l.artifacts) ? l.artifacts : {};
  const row = rows.find(r => r.run === l.run);
  const modules = Object.entries(arts).filter(([, a]) => plain(a));
  const chips = modules.map(([module, a]) => {
    const status = str(plain(a.json) ? a.json.status : null) ?? str(row?.artifacts?.[module]?.status);
    return { module, text: chipText(module, a, status, str(row?.boardsProvider)) };
  });
  const mode = plain(arts.mode) && plain(arts.mode.headline) ? arts.mode.headline : {};
  const exp = mode.expectation;
  const rev = plain(mode.expectation_review) ? mode.expectation_review : {};
  return {
    run: l.run, asOf: str(l.asOf), session: str(l.session), snapshotId: str(l.snapshotId), marketRun: str(l.marketRun), chips,
    expectation: plain(exp) ? Object.entries(exp).map(([k, v]) => [k, valueWord(v)]) : null,
    review: str(rev.grade) && str(rev.previous_run) ? t('channel.run.review', { grade: rev.grade, run: rev.previous_run }) : null,
    details: modules.map(([module, a]) => ({ module, json: compact(a.json ?? null) })),
  };
}

// {latest: {run, asOf, session, snapshotId, marketRun, chips: [{module, text}], expectation: [[key, value]] | null,
//   review: string | null, details: [{module, json}]} | null, rows: [{run, asOf, sealed, artifacts: string[], bytes}], omitted, empty}
export function runsView(body) {
  const wire = Array.isArray(body?.runs) ? body.runs.filter(r => plain(r) && typeof r.run === 'string') : [];
  const latest = latestOf(body?.latestRun, wire);
  const rows = wire.map(r => ({
    run: r.run, asOf: str(r.asOf), sealed: r.sealed === true,
    artifacts: plain(r.artifacts) ? Object.keys(r.artifacts) : [], bytes: typeof r.bytes === 'number' ? r.bytes : null,
  }));
  const omitted = Number.isInteger(body?.runsOmitted) && body.runsOmitted > 0 ? body.runsOmitted : 0;
  const empty = rows.length === 0 && !latest ? t('channel.run.none') : !latest ? t('channel.run.noneSealed') : null;
  return { latest, rows, omitted, empty };
}
