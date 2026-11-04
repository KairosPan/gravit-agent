// gravit-ui/js/mask.js — the display mask for a key pasted into the operator's words (spec §5.9, D25, A2): a text
// split into text and secret runs, and an excerpt's masked form of the same length. Display only — nothing sent,
// stored or copied passes through here.
export const KEEP = 8;

// a shape stands alone: no [A-Za-z0-9_] before it, and after it neither those nor a character of its own body's class
// (so xoxb-1234567890 is not the front of xoxb-1234567890-abcdefghij_more)
const B = '(?<![A-Za-z0-9_])';
const WORD_END = '(?![A-Za-z0-9_])';
const DASH_END = '(?![A-Za-z0-9_-])';
const KEYS = [
  ['sk-[A-Za-z0-9_-]{20,}', DASH_END], ['AIza[0-9A-Za-z_-]{35}', DASH_END], ['gh[pousr]_[A-Za-z0-9]{36,}', WORD_END],
  ['github_pat_[A-Za-z0-9_]{22,}', WORD_END], ['glpat-[A-Za-z0-9_-]{20,}', DASH_END], ['npm_[A-Za-z0-9]{36}', WORD_END],
  ['hf_[A-Za-z0-9]{30,}', WORD_END], ['(?:AKIA|ASIA)[A-Z0-9]{16}', WORD_END], ['LTAI[A-Za-z0-9]{12,}', WORD_END],
  ['AKID[A-Za-z0-9]{13,}', WORD_END], ['xox[abprs]-[A-Za-z0-9-]{10,}', DASH_END],
  ['(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}', WORD_END], ['whsec_[A-Za-z0-9+/=]{20,}', '(?![A-Za-z0-9_+/=])'],
  ['eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}', DASH_END],
  ['\\d{8,10}:[A-Za-z0-9_-]{35}', DASH_END], ['(?:PK|AK)[A-Z0-9]{18}', WORD_END],
];
// one expression per shape, so a match one shape refuses never hides another shape's; each is anchored on its left,
// so a long run of word characters is scanned once, not once per position
const KEY = KEYS.map(([shape, end]) => new RegExp(`${B}(?:${shape})${end}`, 'g'));
const BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const END = /-----END [A-Z ]*PRIVATE KEY-----/g;
// <scheme>://<user>:<password>@ — the scheme anchored on its left; user and password stop at a delimiter
const URL_PASSWORD = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@:,;()[\]{}]*:([^\s/?#@:,;()[\]{}]+)@/g;
// the clip rule's prefixes, tried at a position (sticky)
const PREFIX = /sk-|AIza|gh[pousr]_|github_pat_|glpat-|npm_|hf_|AKIA|ASIA|LTAI|AKID|xox[abprs]-|[sr]k_(?:live|test)_|whsec_|eyJ/y;
const WORD = /[A-Za-z0-9_]/;

const kept = text => text.slice(0, KEEP) + '*'.repeat(Math.max(0, text.length - KEEP));
// a private-key block keeps its BEGIN and END lines and every line break
const armoured = (text, head, foot) =>
  text.slice(0, head) + text.slice(head, text.length - foot).replace(/[^\r\n]/g, '*') + text.slice(text.length - foot);

// every candidate as {start, end, masked}
function candidates(text) {
  const found = [];
  for (const shape of KEY) {
    for (const m of text.matchAll(shape)) {
      if (m[0].startsWith('sk-') && !/\d/.test(m[0].slice(3))) continue;
      found.push({ start: m.index, end: m.index + m[0].length, masked: kept(m[0]) });
    }
  }
  // a block runs from a BEGIN to the first END after it; with no END left, no later BEGIN has one either
  BEGIN.lastIndex = 0;
  for (let begin; (begin = BEGIN.exec(text));) {
    END.lastIndex = BEGIN.lastIndex;
    const end = END.exec(text);
    if (!end) break;
    const stop = end.index + end[0].length;
    found.push({ start: begin.index, end: stop, masked: armoured(text.slice(begin.index, stop), begin[0].length, end[0].length) });
    BEGIN.lastIndex = stop;
  }
  for (const m of text.matchAll(URL_PASSWORD)) {
    const end = m.index + m[0].length - 1;
    found.push({ start: end - m[1].length, end, masked: '*'.repeat(m[1].length) });
  }
  return found;
}

function scan(text) {
  // one pass left to right: the earliest start wins, then the longest; an overlapped match is dropped
  const found = candidates(text).sort((a, b) => a.start - b.start || b.end - a.end);
  const runs = [];
  let at = 0;
  for (const hit of found) {
    if (hit.start < at) continue;
    if (hit.start > at) runs.push({ type: 'text', text: text.slice(at, hit.start) });
    runs.push({ type: 'secret', text: text.slice(hit.start, hit.end), masked: hit.masked });
    at = hit.end;
  }
  if (at < text.length) runs.push({ type: 'text', text: text.slice(at) });
  return runs;
}

export const MEMO_MAX = 500;
// a longer text is masked afresh each time rather than held
export const MEMO_TEXT_MAX = 16_384;
const memo = new Map();
export const memoSize = () => memo.size;

export function maskSpans(text) {
  const key = String(text ?? '');
  let runs = memo.get(key);
  if (runs) return runs;
  runs = Object.freeze(scan(key).map(run => Object.freeze(run)));
  if (key.length > MEMO_TEXT_MAX) return runs;
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, runs);
  return runs;
}

export function maskExcerpt(text) {
  const source = String(text ?? '');
  const runs = maskSpans(source);
  const out = runs.map(run => (run.type === 'secret' ? run.masked : run.text)).join('');
  if (!out.endsWith('…')) return out;
  // the clip rule: within the token before the ellipsis (back to whitespace), the earliest position at the token's
  // start or after a non-word character where a prefix begins — so KEY=sk-…, "key":"sk-… and token:ghp_… clip too
  const cut = out.length - 1;
  let first = cut;
  while (first > 0 && !/\s/.test(source[first - 1])) first -= 1;
  for (let at = first; at < cut; at += 1) {
    if (at > first && WORD.test(source[at - 1])) continue;
    PREFIX.lastIndex = at;
    const prefix = PREFIX.exec(source);
    if (!prefix || at + prefix[0].length > cut) continue;
    const length = cut - at;
    const keep = length > KEEP ? KEEP : prefix[0].length;
    return out.slice(0, at + keep) + '*'.repeat(length - keep) + out.slice(cut);
  }
  return out;
}
