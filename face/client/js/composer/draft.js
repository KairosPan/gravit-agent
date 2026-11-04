// The composer's draft model: runs of text and chips, the trigger rule, and the serializer that turns a draft into the
// text sent. Pure, no DOM. A draft is {runs}; plan 4 adds `files` beside it.
//   Run  = {type: 'text', text} | {type: 'chip', chip}
//   Chip = {kind: 'bot', id, label} | {kind: 'file', path, dir, label} | {kind: 'conversation', id, label}
// The caret counts in units: a text run's UTF-16 length, 1 for a chip.

const text = s => ({ type: 'text', text: s });

export const emptyDraft = () => ({ runs: [] });
export const textDraft = s => ({ runs: s ? [text(s)] : [] });

/** Adjacent text runs merged, empty ones dropped. */
export function normalize(runs) {
  const out = [];
  for (const r of runs) {
    if (r.type === 'text') {
      if (!r.text) continue;
      const last = out[out.length - 1];
      if (last && last.type === 'text') { out[out.length - 1] = text(last.text + r.text); continue; }
      out.push(text(r.text));
    } else out.push(r);
  }
  return out;
}

const unitsOf = r => (r.type === 'text' ? r.text.length : 1);

export const lengthOf = runs => runs.reduce((n, r) => n + unitsOf(r), 0);
export const isBlank = runs => runs.every(r => r.type === 'text' && !r.text.trim());
export const plainText = runs => runs.map(r => (r.type === 'text' ? r.text : r.chip.label)).join('');
export const hasChip = (runs, kind) => runs.some(r => r.type === 'chip' && r.chip.kind === kind);

/** Replace caret units [from, to) with `insert` (a string or runs). A text run an edge falls in is split; a chip is whole. */
export function replaceRange(runs, from, to, insert) {
  if (from > to) [from, to] = [to, from];
  const ins = typeof insert === 'string' ? [text(insert)] : insert;
  const head = [], tail = [];
  let pos = 0;
  for (const r of runs) {
    const n = unitsOf(r), end = pos + n;
    if (r.type === 'chip') {
      if (end <= from) head.push(r);
      else if (pos >= to) tail.push(r);
      // else the chip lies inside the range: removed whole
    } else {
      if (pos < from) head.push(text(r.text.slice(0, Math.min(n, from - pos))));
      if (end > to) tail.push(text(r.text.slice(Math.max(0, to - pos))));
    }
    pos = end;
  }
  return normalize([...head, ...ins, ...tail]);
}

const AT = /^@([^\s@]*)$/u;
const SLASH = /^[^\p{L}\p{N}\s@/]*\/([^\s/]*)$/u;

/** The `/` or `@` token before the caret, inside the caret's text run; a chip ends it as whitespace does. */
export function triggerAt(runs, at) {
  let pos = 0;
  for (const r of runs) {
    const end = pos + unitsOf(r);
    if (r.type === 'text' && at > pos && at <= end) {
      const before = r.text.slice(0, at - pos);
      const m = /\S*$/u.exec(before);
      const tokenStart = m.index;
      const token = m[0];
      const a = AT.exec(token);
      if (a) return { kind: '@', from: pos + tokenStart, query: a[1], atStart: pos + tokenStart === 0 };
      const s = SLASH.exec(token);
      if (s) {
        const from = pos + tokenStart + token.indexOf('/');
        return { kind: '/', from, query: s[1], atStart: from === 0 };
      }
      return null;
    }
    pos = end;
  }
  return null;
}

const b64url = s => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = p => {
  const bin = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};

/** dsh's canonical session URI (`encodeSessionReferenceUri`), made here without Buffer. */
export const sessionUri = sessionId => 'dsh-session:' + b64url(JSON.stringify(sessionId));

const escLabel = l => l.replace(/[\\\]]/gu, m => '\\' + m);
const unescLabel = l => l.replace(/\\(.)/gu, '$1');
const mention = (id, label) => `@[${escLabel(label ?? id)}](${sessionUri(id)})`;

/** D15: a file's path as the agent reads it, before quoting: relative to the cwd when under it, `.` for the cwd, else absolute. */
export function filePathFor(path, { repoRoot, cwd }) {
  const clean = path.replace(/\/+$/, '');
  if (!repoRoot) return clean;
  const abs = `${repoRoot.replace(/\/+$/, '')}/${clean}`;
  if (!cwd) return abs;
  const c = cwd.replace(/\/+$/, '');
  if (abs === c) return '.';
  if (abs.startsWith(c + '/')) return abs.slice(c.length + 1);
  return abs;
}

/** The text sent. */
export function serialize(runs, ctx) {
  return runs.map(r => {
    if (r.type === 'text') return r.text;
    const c = r.chip;
    if (c.kind === 'bot') return `@${c.id}`;
    if (c.kind === 'conversation') return mention(c.id, c.label);
    const p = filePathFor(c.path, ctx);
    return /\s/u.test(p) ? `@"${p}"` : `@${p}`;
  }).join('');
}

/** {repoRoot, cwd}: the root channel's dir and the conversation's channel's dir, each or null. */
export function serialContext({ channels, workspaceId }) {
  const list = channels ?? [];
  const root = list.find(c => c.isRoot);
  const own = workspaceId == null ? null : list.find(c => c.workspaceId === workspaceId);
  return { repoRoot: root?.dir ?? null, cwd: own?.dir ?? null };
}

function decodeUri(uri) {
  if (!uri.startsWith('dsh-session:')) return null;
  const p = uri.slice('dsh-session:'.length);
  if (!/^[A-Za-z0-9_-]+$/.test(p)) return null;
  try {
    const id = JSON.parse(unb64url(p));
    return typeof id === 'string' && sessionUri(id) === uri ? id : null;
  } catch { return null; }
}

/** The operator's sent text as bubble runs (D17): a well-formed mention is a ref with its unescaped label, anything else stays text. */
export function sessionRefRuns(s) {
  const pattern = /@\[((?:\\.|[^\\\]])*)\]\((dsh-session:[^\s)]*)\)/gu;
  const out = [];
  let last = 0, m;
  while ((m = pattern.exec(s))) {
    if (decodeUri(m[2]) == null) continue;
    if (m.index > last) out.push(text(s.slice(last, m.index)));
    out.push({ type: 'ref', label: unescLabel(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(text(s.slice(last)));
  return normalize(out);
}
