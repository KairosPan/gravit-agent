// The words scanner (plan 6): a client source parsed as JavaScript (typescript's createSourceFile), its English literals —
// the face's words still written in place rather than read from the table — its words calls, and the names it binds beside
// the words it imports. words-guard.test.js runs it over face/client/js.
import ts from 'typescript';

export const WORDS_CALLS = ['t', 'th', 'tn', 'thn', 'said', 'saidn', 'saidError'];
// the calls that read the table now; said and saidn keep a key and params for the draw
const READS = new Set(['t', 'th', 'tn', 'thn']);
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

// the literals a source keeps in place on purpose and on screen: every string's and template part's text on a line marked
// `// en-kept:` (a provider's name, a key's name, a path) — the words the probe (words-probe.test.js) may meet on a screen
// from the source itself. A marker whose reason says the literal is never on screen, and an Error's message, count for nothing
const OFF_SCREEN = /never on screen/;
export function keptLiterals(source, file = 'source.js') {
  const sf = parse(source, file);
  const lines = source.split('\n');
  const kept = node => { const line = lines[lineAt(sf, node.getStart(sf)) - 1] ?? ''; return KEPT.test(line) && !OFF_SCREEN.test(line.slice(line.search(KEPT))); };
  const inError = node => { let up = node.parent; while (up && (ts.isTemplateSpan(up) || ts.isTemplateExpression(up) || ts.isBinaryExpression(up) || ts.isParenthesizedExpression(up))) up = up.parent; return !!up && ts.isNewExpression(up) && ts.isIdentifier(up.expression) && up.expression.text === 'Error'; };
  const out = [];
  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && kept(node) && !inError(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node) && !inError(node)) for (const p of [node.head, ...node.templateSpans.map(s => s.literal)]) if (kept(p)) out.push(p.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// a words call whose result the store keeps, read under the table standing then rather than the one standing when it is
// drawn (plan 7 Task 2): a t, th, tn or thn that is an argument of a dispatch, a value in an object literal passed to one,
// the right side of an assignment to a property, or any in a reducer (a reducer reads no table). The value climbs through
// parentheses, a conditional's branches, ||, ?? and &&, a concatenation, a template's hole and an object literal's value;
// en-kept exempts none of them. A line kept this way is said(key, params), read at its draw with sayOf
const CLIMB_OPS = new Set([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken]);
export function storedWords(source, file = 'source.js') {
  const sf = parse(source, file);
  const inReducer = /(^|\/)reducers\//.test(file);
  const out = [];
  const climb = node => {
    let up = node;
    for (;;) {
      const p = up.parent;
      if (!p) return up;
      if (ts.isParenthesizedExpression(p)) up = p;
      else if (ts.isConditionalExpression(p) && p.condition !== up) up = p;
      else if (ts.isBinaryExpression(p) && CLIMB_OPS.has(p.operatorToken.kind)) up = p;
      else if (ts.isTemplateSpan(p)) up = p.parent;
      else if (ts.isPropertyAssignment(p) && p.initializer === up) up = p.parent;
      else if (ts.isObjectLiteralExpression(p) || ts.isSpreadAssignment(p)) up = p;
      else return up;
    }
  };
  const isDispatch = call => ts.isCallExpression(call) && (ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text === 'dispatch' : ts.isIdentifier(call.expression) && call.expression.text === 'dispatch');
  const visit = node => {
    if (isWordsCall(node) && READS.has(node.expression.text)) {
      const top = climb(node);
      const p = top.parent;
      const why = inReducer ? 'in a reducer'
        : p && isDispatch(p) && p.arguments.includes(top) ? 'dispatched'
        : p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === top && (ts.isPropertyAccessExpression(p.left) || ts.isElementAccessExpression(p.left)) ? 'assigned to a property'
        : null;
      if (why) out.push({ line: lineAt(sf, node.getStart(sf)), fn: node.expression.text, key: node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null, why });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// a sentence the code assembles in English word order, which no table can reorder (plan 7 Tasks 4-5): a template literal
// whose holes stand side by side with only whitespace or punctuation between them, one of them holding a words call; a
// .join(…) over an array literal (through .filter) with a words call among two items or more, its separator whitespace
// or punctuation; and a + chain joining a words call to anything but a literal. A hole, an item or an operand holds a words
// call when it is one (through parentheses, a conditional, ||, ?? and && and esc). A join that is no sentence (a class list, a path, a key, a
// list of codes) carries `// words-order: <reason>` on the line the join starts or on the words call's line, and is not reported
const ORDERED = /\/\/\s*words-order:/;
const READ_CALLS = new Set(['t', 'th', 'tn', 'thn', 'sayOf']);
const BETWEEN = /^[\s\p{P}\p{S}]*$/u;
const between = text => BETWEEN.test(text) && !/[<>"'=]/.test(text);
export function assembled(source, file = 'source.js') {
  const sf = parse(source, file);
  const lines = source.split('\n');
  const marked = node => ORDERED.test(lines[lineAt(sf, node.getStart(sf)) - 1] ?? '');
  // a words call standing as the value itself: through parentheses, a conditional's branches, ||, ?? and &&, and esc(); one
  // inside any other call (a key, a chip, a nested template) is markup of its own, not a word in this sentence
  const words = node => {
    if (!node) return null;
    if (ts.isParenthesizedExpression(node)) return words(node.expression);
    if (ts.isConditionalExpression(node)) return words(node.whenTrue) ?? words(node.whenFalse);
    if (ts.isBinaryExpression(node) && CLIMB_OPS.has(node.operatorToken.kind) && node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return words(node.left) ?? words(node.right);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (READ_CALLS.has(node.expression.text)) return node;
      if (node.expression.text === 'esc') return words(node.arguments[0]);
    }
    return null;
  };
  const isLiteral = n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n);
  const out = [];
  const report = (node, call) => {
    if (marked(node) || (call && marked(call))) return;
    out.push({ line: lineAt(sf, node.getStart(sf)), text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 120) });
  };
  const visit = node => {
    if (ts.isTemplateExpression(node)) {
      const spans = node.templateSpans;
      for (let i = 0; i + 1 < spans.length; i += 1) {
        const a = spans[i].expression, b = spans[i + 1].expression;
        const call = words(a) ?? words(b);
        if (call && between(spans[i].literal.text)) { report(node, call); break; }
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
      const sep = node.arguments[0];
      let arr = node.expression.expression;
      while (ts.isCallExpression(arr) && ts.isPropertyAccessExpression(arr.expression) && arr.expression.name.text === 'filter') arr = arr.expression.expression;
      if (ts.isArrayLiteralExpression(arr) && arr.elements.length >= 2 && (!sep || (isLiteral(sep) && between(sep.text)))) {
        const call = arr.elements.map(words).find(Boolean);
        if (call) report(node, call);
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
      && !(ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const operands = [];
      const flat = n => { if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) { flat(n.left); flat(n.right); } else operands.push(n); };
      flat(node);
      const call = operands.map(words).find(Boolean);
      if (call && operands.some(o => !isLiteral(o) && !words(o))) report(node, call);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out.sort((a, b) => a.line - b.line);
}
