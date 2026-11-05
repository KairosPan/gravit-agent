// The words scanner (plan 6): a client source parsed as JavaScript (typescript's createSourceFile), its English literals —
// the face's words still written in place rather than read from the table — its words calls, and the names it binds beside
// the words it imports. words-guard.test.js runs it over face/client/js.
import ts from 'typescript';

export const WORDS_CALLS = ['t', 'th', 'tn', 'thn'];
export const KEY_NAMES = new Set(['Enter', 'Escape', 'Esc', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'Shift', 'Meta', 'Control', 'Alt', 'Space']);

// a word is a whole run, never part of `seg-item` or `#/markets/`; it may hold an apostrophe (Can't), and a phrase may lead
// with an acronym (MCP server)
const PHRASE = /(?<![\w'’-])(?:[A-Za-z][a-z]+(?:['’][a-z]+)?|[A-Z]{2,})\s+[A-Za-z][a-z]*(?:['’][a-z]+)?(?![\w'’-])/;
// one capitalized word alone, with its end punctuation; OK is the one acronym that stands alone as a word
const WORD = /^(?:[A-Z][a-z]+(?:['’][a-z]+)?|OK)[.…!?:]*$/;
// in a template's text outside a tag: any word of two letters or more (`${n} running`, `cache ${p}%`), but not a piece of a
// path, a key, a call or a CSS unit
const LAX = /(?<![\w'’\-/.#=:&?%$@+\\])[A-Za-z][a-z]+(?:['’][a-z]+)?(?![\w'’\-/.(=:+])/g;
const UNITS = new Set(['px', 'em', 'rem', 'vh', 'vw', 'ms', 'deg', 'fr']);
// the attributes whose values a reader meets (or a screen reader speaks), kept when a tag is removed
const READ_ATTRS = /\b(?:aria-label|aria-description|title|placeholder|alt|value)=(?:"([^"]*)"|'([^']*)')/g;
const KEPT = /\/\/\s*en-kept:/;
const HOLE = '\u0000'; // where a template's ${…} stood

const parse = (source, file) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const lineAt = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const isWordsCall = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && WORDS_CALLS.includes(node.expression.text);

const strict = p => PHRASE.test(p) || (WORD.test(p) && !KEY_NAMES.has(p.replace(/[.…!?:]+$/, '')));
// a word touching a hole with no space between (`sz${code}`) is part of a name the hole completes, not a word
const lax = piece => [...piece.text.matchAll(LAX)].some(m => !UNITS.has(m[0])
  && !(piece.holeBefore && m.index === 0) && !(piece.holeAfter && m.index + m[0].length === piece.text.length));

// a text's readable pieces, each { text, at, inText, holeBefore, holeAfter }: the runs between tags, and the read attributes'
// values in the tags (a tag cut at the text's start or end, as a template's part may be, counts as a tag); each split at the
// holes, and marked where its text touches one with no space between
function pieces(text) {
  const out = [];
  const push = (run, at, inText) => {
    let from = 0;
    const parts = run.split(HOLE);
    for (const [i, part] of parts.entries()) {
      const lead = part.length - part.trimStart().length;
      const holeBefore = i > 0 && lead === 0;
      const holeAfter = i < parts.length - 1 && part.trimEnd().length === part.length;
      if (part.trim()) out.push({ text: part.trim(), at: at + from + lead, inText, holeBefore, holeAfter });
      from += part.length + 1;
    }
  };
  const tag = (chunk, at) => { for (const m of chunk.matchAll(READ_ATTRS)) { const v = m[1] ?? m[2]; push(v, at + m.index + m[0].indexOf(v, m[0].indexOf('=')), false); } };
  let start = 0, end = text.length;
  const lead = text.match(/^[^<>]*>/);
  if (lead) { tag(lead[0], 0); start = lead[0].length; }
  const tail = text.slice(start).match(/<[^>]*$/);
  if (tail) { end = start + tail.index; tag(tail[0], end); }
  const re = /<[^>]*>/g;
  const body = text.slice(start, end);
  let last = 0, m;
  while ((m = re.exec(body))) {
    push(body.slice(last, m.index), start + last, true);
    tag(m[0], start + m.index);
    last = m.index + m[0].length;
  }
  push(body.slice(last), start + last, true);
  return out;
}

function exempt(node) {
  const parent = node.parent;
  if (!parent) return false;
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (isWordsCall(parent) && parent.arguments[0] === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return true;
  // a token list: the value of an attrs `class` or `rel`, or a cls() argument
  const propName = ts.isPropertyAssignment(parent) && parent.initializer === node ? parent.name : null;
  if (propName && (ts.isIdentifier(propName) || ts.isStringLiteral(propName)) && (propName.text === 'class' || propName.text === 'rel')) return true;
  let arg = node;
  while (arg.parent && (ts.isBinaryExpression(arg.parent) || ts.isConditionalExpression(arg.parent) || ts.isParenthesizedExpression(arg.parent)) && arg.parent.condition !== arg) arg = arg.parent;
  const call = arg.parent;
  if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'cls' && call.arguments.includes(arg)) return true;
  return false;
}

export function englishLiterals(source, file = 'source.js') {
  const sf = parse(source, file);
  const lines = source.split('\n');
  const kept = line => KEPT.test(lines[line - 1] ?? '');
  const found = [];
  // a literal's parts (one, or a template's head and spans' literals), joined with a hole where each ${…} stood
  const scan = (parts, template) => {
    let joined = '';
    const starts = [];
    for (const [i, p] of parts.entries()) { starts.push({ at: joined.length, node: p }); joined += p.text + (i < parts.length - 1 ? HOLE : ''); }
    const hits = new Map();
    for (const piece of pieces(joined)) {
      if (!(strict(piece.text) || (template && piece.inText && lax(piece)))) continue;
      const owner = starts.filter(s => s.at <= piece.at).at(-1);
      const line = lineAt(sf, owner.node.getStart(sf)) + (joined.slice(owner.at, piece.at).match(/\n/g) ?? []).length;
      if (kept(line)) continue;
      hits.set(line, [...(hits.get(line) ?? []), piece.text]);
    }
    for (const [line, texts] of hits) found.push({ line, text: texts.join(' | ') });
  };
  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !exempt(node)) scan([node], false);
    else if (ts.isTemplateExpression(node) && !exempt(node)) scan([node.head, ...node.templateSpans.map(s => s.literal)], true);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found.sort((a, b) => a.line - b.line);
}

// a function called where it is written — `(() => …)()` — runs when its module loads
function invokedAtOnce(node) {
  let up = node;
  while (up.parent && ts.isParenthesizedExpression(up.parent)) up = up.parent;
  return !!up.parent && ts.isCallExpression(up.parent) && up.parent.expression === up;
}

// every words call: its key when it is a literal, and whether it runs when the module loads (no function around it that waits
// to be called)
export function wordsCalls(source, file = 'source.js') {
  const sf = parse(source, file);
  const calls = [];
  const visit = (node, inFunction) => {
    if (isWordsCall(node)) {
      const arg = node.arguments[0];
      const key = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
      calls.push({ line: lineAt(sf, node.getStart(sf)), fn: node.expression.text, key, topLevel: !inFunction });
    }
    const inner = inFunction || ((ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node)) && !invokedAtOnce(node));
    ts.forEachChild(node, child => visit(child, inner));
  };
  visit(sf, false);
  return calls;
}

const isWordsModule = spec => /(^|\/)i18n\/words\.js$|^\.\/words\.js$/.test(spec);
const DECLARES = [ts.isVariableDeclaration, ts.isParameter, ts.isFunctionDeclaration, ts.isFunctionExpression, ts.isBindingElement, ts.isClassDeclaration, ts.isClassExpression];

// in a file that imports the words: an import of them other than by their own names, and every name of theirs it binds
// again (a local, a parameter, a function, a destructured name, an import from elsewhere) — each would make a call to it
// something other than a words call. [] for a file that imports no words
export function wordsBindings(source, file = 'source.js') {
  const sf = parse(source, file);
  const out = [];
  const at = node => lineAt(sf, node.getStart(sf));
  let imports = false;
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const words = isWordsModule(st.moduleSpecifier.text);
    const clause = st.importClause;
    if (!clause) continue;
    if (words) {
      imports = true;
      if (clause.name) out.push({ line: at(st), name: clause.name.text, why: 'default import' });
      const b = clause.namedBindings;
      if (b && ts.isNamespaceImport(b)) out.push({ line: at(st), name: b.name.text, why: 'namespace import' });
      if (b && ts.isNamedImports(b)) for (const el of b.elements) if (el.propertyName && el.propertyName.text !== el.name.text) out.push({ line: at(st), name: el.name.text, why: 'aliased import' });
    } else {
      const b = clause.namedBindings;
      const names = [clause.name, ...(b && ts.isNamedImports(b) ? b.elements.map(el => el.name) : []), b && ts.isNamespaceImport(b) ? b.name : null].filter(Boolean);
      for (const n of names) if (WORDS_CALLS.includes(n.text)) out.push({ line: at(st), name: n.text, why: 'local binding' });
    }
  }
  if (!imports) return [];
  const visit = node => {
    if (ts.isIdentifier(node) && WORDS_CALLS.includes(node.text) && node.parent && DECLARES.some(is => is(node.parent)) && node.parent.name === node) {
      out.push({ line: at(node), name: node.text, why: 'local binding' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort((a, b) => a.line - b.line);
}

// the literals a source keeps in place on purpose: every string's and template part's text on a line marked `// en-kept:` (a
// provider's name, a key's name, a path) — the words the probe (words-probe.test.js) may meet on a screen from the source itself
export function keptLiterals(source, file = 'source.js') {
  const sf = parse(source, file);
  const lines = source.split('\n');
  const kept = node => KEPT.test(lines[lineAt(sf, node.getStart(sf)) - 1] ?? '');
  const out = [];
  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && kept(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) for (const p of [node.head, ...node.templateSpans.map(s => s.literal)]) if (kept(p)) out.push(p.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
