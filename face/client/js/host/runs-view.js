// face/client/js/host/runs-view.js — a channel's Lunhui research runs (modules spec A14, §5.11), shaped from the
// overview's runs, runsOmitted and latestRun. Pure. Every string is the wire's, passed through as data for the view to
// escape; an artifact the server could not read is simply absent, and no run holds one yet before plan 2.

const scalar = v => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : null);
const ARRAY_SHOWN = 3;

// a count with its noun, singular for one: 1 item, 2 items
export const countWord = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// one headline value as a word: a scalar as itself (a fraction to four places), a short list of scalars joined, any
// other list by its length, an object by its field count
export function valueWord(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e4) / 1e4);
  if (scalar(v)) return String(v);
  if (Array.isArray(v)) return v.length <= ARRAY_SHOWN && v.every(scalar) ? v.map(valueWord).join(', ') : countWord(v.length, 'item');
  if (plain(v)) return countWord(Object.keys(v).length, 'field');
  return '';
}

// a module's chip: its headline values joined, `not evaluable` for a module whose evidence was missing, the
// counterevidence by its items' count, the mode by its mode word alone (its card and review are lines of their own)
function chipText(module, art, status) {
  if (status === 'NOT_EVALUABLE') return `${module}: not evaluable`;
  const h = plain(art.headline) ? art.headline : {};
  if (module === 'counterevidence') return `${module}: ${countWord(Array.isArray(h.items) ? h.items.length : 0, 'item')}`;
  if (module === 'mode') return typeof h.mode === 'string' ? `${module}: ${h.mode}` : module;
  const words = Object.values(h).filter(v => v !== undefined).map(valueWord).filter(w => w !== '');
  return words.length ? `${module}: ${words.join(' · ')}` : module;
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
    return { module, text: chipText(module, a, status) };
  });
  const mode = plain(arts.mode) && plain(arts.mode.headline) ? arts.mode.headline : {};
  const exp = mode.expectation;
  const rev = plain(mode.expectation_review) ? mode.expectation_review : {};
  return {
    run: l.run, asOf: str(l.asOf), session: str(l.session), snapshotId: str(l.snapshotId), marketRun: str(l.marketRun), chips,
    expectation: plain(exp) ? Object.entries(exp).map(([k, v]) => [k, valueWord(v)]) : null,
    review: str(rev.grade) && str(rev.previous_run) ? `review: ${rev.grade} of ${rev.previous_run}` : null,
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
  const empty = rows.length === 0 && !latest ? 'no runs yet' : !latest ? 'no sealed run with an artifact yet' : null;
  return { latest, rows, omitted, empty };
}
