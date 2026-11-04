// gravit-ui/js/mask.js — the display mask for a key pasted into the operator's words (spec §5.9, D25, A2): a text
// split into text and secret runs, and an excerpt's masked form of the same length. Display only — nothing sent,
// stored or copied passes through here.
export const KEEP = 8;

// a shape stands alone: no [A-Za-z0-9_] on either side
const B = '(?<![A-Za-z0-9_])';
const E = '(?![A-Za-z0-9_])';
const KEYS = [
  'sk-[A-Za-z0-9_-]{20,}', 'AIza[0-9A-Za-z_-]{35}', 'gh[pousr]_[A-Za-z0-9]{36,}', 'github_pat_[A-Za-z0-9_]{22,}',
  'glpat-[A-Za-z0-9_-]{20,}', 'npm_[A-Za-z0-9]{36}', 'hf_[A-Za-z0-9]{30,}', '(?:AKIA|ASIA)[A-Z0-9]{16}',
  'LTAI[A-Za-z0-9]{12,}', 'AKID[A-Za-z0-9]{13,}', 'xox[abprs]-[A-Za-z0-9-]{10,}', '(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}',
  'whsec_[A-Za-z0-9+/=]{20,}', 'eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}',
  '\\d{8,10}:[A-Za-z0-9_-]{35}', '(?:PK|AK)[A-Z0-9]{18}',
];
// one expression per shape, so a match one shape refuses never hides another shape's
const KEY = KEYS.map(shape => new RegExp(`${B}(?:${shape})${E}`, 'g'));
const BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const URL_PASSWORD = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:([^\s/@]+)@/g;
// the clip rule's prefixes: a token cut by the excerpt's ellipsis that starts with one is masked past them
const PREFIX = /^(?:sk-|AIza|gh[pousr]_|github_pat_|glpat-|npm_|hf_|AKIA|ASIA|LTAI|AKID|xox[abprs]-|[sr]k_(?:live|test)_|whsec_|eyJ)/;

const kept = text => text.slice(0, KEEP) + '*'.repeat(Math.max(0, text.length - KEEP));
// a private-key block keeps its BEGIN and END lines and every line break
const armoured = text => {
  const head = text.indexOf('-----', 5) + 5, foot = text.lastIndexOf('-----END');
  return text.slice(0, head) + text.slice(head, foot).replace(/[^\r\n]/g, '*') + text.slice(foot);
};

// every candidate as {start, end, masked}
function candidates(text) {
  const found = [];
  for (const shape of KEY) {
    for (const m of text.matchAll(shape)) {
      if (m[0].startsWith('sk-') && !/\d/.test(m[0].slice(3))) continue;
      found.push({ start: m.index, end: m.index + m[0].length, masked: kept(m[0]) });
    }
  }
  for (const m of text.matchAll(BLOCK)) found.push({ start: m.index, end: m.index + m[0].length, masked: armoured(m[0]) });
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

const MEMO_MAX = 500;
const memo = new Map();

export function maskSpans(text) {
  const key = String(text ?? '');
  let runs = memo.get(key);
  if (runs) return runs;
  runs = scan(key);
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(key, runs);
  return runs;
}

export function maskExcerpt(text) {
  const runs = maskSpans(text);
  let out = runs.map(run => (run.type === 'secret' ? run.masked : run.text)).join('');
  if (!out.endsWith('…')) return out;
  // the clip rule: the token before the ellipsis, back to whitespace and past any leading punctuation
  const cut = out.length - 1;
  let start = cut;
  while (start > 0 && !/\s/.test(out[start - 1])) start -= 1;
  while (start < cut && !/[A-Za-z0-9_]/.test(out[start])) start += 1;
  const token = String(text).slice(start, cut);
  const prefix = PREFIX.exec(token);
  if (!prefix) return out;
  const keep = token.length > KEEP ? KEEP : prefix[0].length;
  out = out.slice(0, start + keep) + '*'.repeat(token.length - keep) + out.slice(cut);
  return out;
}
