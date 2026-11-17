// face/client/js/host/memory-page-view.js — the Memory screen's pure views (render/memory-lessons.js draws them): a card's armed
// copy beside its file now, each line marked; one outcome side of a lesson's record by horizon, the median once the memory gives
// one (from eight measured cases), else the cases measured at that horizon; and a card as one line of its codes. No DOM, no
// words, no store: what comes from the memory comes back as it came, for the renderer to make visible and escape.

/** The most characters of a card's text the face serves (src/memory-screen.ts SCREEN_TEXT_MAX). */
export const SCREEN_TEXT_MAX = 16_384;

const str = v => (typeof v === 'string' ? v : '');
const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
const finite = v => typeof v === 'number' && Number.isFinite(v);

// a text's lines: none for an empty text, and no empty line after a final line break
function linesOf(text) {
  const s = str(text);
  if (s === '') return [];
  const lines = s.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** The lines of two texts, each marked: 'same', 'armed' (in the armed copy alone) or 'file' (in the file alone), by line set, in each text's own order. */
export function textDiff(armedText, fileText) {
  const armed = linesOf(armedText);
  const file = linesOf(fileText);
  const inArmed = new Set(armed);
  const inFile = new Set(file);
  return {
    armed: armed.map(line => ({ line, mark: inFile.has(line) ? 'same' : 'armed' })),
    file: file.map(line => ({ line, mark: inArmed.has(line) ? 'same' : 'file' })),
  };
}

/** For one outcome side of a record: per horizon, the median when the record has one, else the cases' figures. */
export function recordView(record, side) {
  if (side !== 'followed' && side !== 'overridden') return [];
  const cases = Array.isArray(record?.[side]) ? record[side].filter(c => c && typeof c === 'object') : [];
  const medians = record?.medians?.[side] && typeof record.medians[side] === 'object' ? record.medians[side] : {};
  const changeAt = (c, k) => {
    const f = Array.isArray(c.figures) ? c.figures.find(x => x && x.k === k) : undefined;
    return f && finite(f.change_pct) ? f.change_pct : null;
  };
  const horizons = new Set();
  for (const [k, v] of Object.entries(medians)) if (finite(v) && Number.isInteger(Number(k))) horizons.add(Number(k));
  for (const c of cases) for (const f of Array.isArray(c.figures) ? c.figures : []) if (f && Number.isInteger(f.k) && finite(f.change_pct)) horizons.add(f.k);
  return [...horizons].sort((a, b) => a - b).map(k => (finite(medians[k])
    ? { k, median: medians[k] }
    : { k, cases: cases.filter(c => changeAt(c, k) !== null).map(c => ({ decision: str(c.decision), date: str(c.date), symbol: str(c.symbol), action: str(c.action), change: changeAt(c, k) })) }));
}

/** A card as one line of words: its strength, what it says, its actions and its scope. */
export function cardLine(card) {
  return {
    strength: str(card?.strength), says: str(card?.says), actions: strings(card?.actions),
    markets: strings(card?.scope?.market), symbols: strings(card?.scope?.symbols),
  };
}
