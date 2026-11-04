// The words scanner (plan 6): a client source parsed as JavaScript (typescript's createSourceFile), its English literals —
// the face's words still written in place rather than read from the table — and its words calls. words-guard.test.js runs it
// over face/client/js.
import ts from 'typescript';

export const WORDS_CALLS = ['t', 'th', 'tn', 'thn'];
export const KEY_NAMES = new Set(['Enter', 'Escape', 'Esc', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'Shift', 'Meta', 'Control', 'Alt', 'Space']);

// two letter words apart by whitespace, a word being a whole whitespace-separated run (so `seg-item pressed` is no phrase);
// or one capitalized word alone, with its end punctuation
const PHRASE = /(?<![\w-])[A-Za-z][a-z]+\s+[A-Za-z][a-z]*(?![\w-])/;
const WORD = /^[A-Z][a-z]+[.…!?:]*$/;
// the attributes whose values a reader meets, kept when a tag is removed
const READ_ATTRS = /\b(?:aria-label|title|placeholder|alt)="([^"]*)"/g;
const KEPT = /\/\/\s*en-kept:/;

const parse = (source, file) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const isWordsCall = node => ts.isCallExpression(node) && ts.isIdentifier(node.expression) && WORDS_CALLS.includes(node.expression.text);

// a literal's readable pieces: the runs of text between tags and the read attributes' values; a piece of a tag cut by an
// interpolation (a template's middle that starts inside one, a head that ends inside one) counts as a tag
function pieces(text) {
  const out = [];
  const keepAttrs = tag => { for (const m of tag.matchAll(READ_ATTRS)) out.push(m[1]); };
  let rest = text;
  const lead = rest.match(/^[^<>]*>/);
  if (lead) { keepAttrs(lead[0]); rest = rest.slice(lead[0].length); }
  const tail = rest.match(/<[^>]*$/);
  if (tail) { keepAttrs(tail[0]); rest = rest.slice(0, tail.index); }
  for (const run of rest.split(/(<[^>]*>)/)) {
    if (run.startsWith('<')) keepAttrs(run);
    else out.push(run);
  }
  return out.map(p => p.trim()).filter(Boolean);
}

const english = p => PHRASE.test(p) || (WORD.test(p) && !KEY_NAMES.has(p.replace(/[.…!?:]+$/, '')));

function exempt(node) {
  const parent = node.parent;
  if (!parent) return false;
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) return true;
  if (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (isWordsCall(parent) && parent.arguments[0] === node) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) && parent.name === node) return true;
  // a class list: the value of an attrs `class`, or a cls() argument
  const propName = ts.isPropertyAssignment(parent) && parent.initializer === node ? parent.name : null;
  if (propName && (ts.isIdentifier(propName) || ts.isStringLiteral(propName)) && propName.text === 'class') return true;
  let arg = node;
  while (arg.parent && (ts.isBinaryExpression(arg.parent) || ts.isConditionalExpression(arg.parent) || ts.isParenthesizedExpression(arg.parent)) && arg.parent.condition !== arg) arg = arg.parent;
  const call = arg.parent;
  if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'cls' && call.arguments.includes(arg)) return true;
  return false;
}

export function englishLiterals(source, file = 'source.js') {
  const sf = parse(source, file);
  const lines = source.split('\n');
  // a marker on the literal's line, or alone on the line before it
  const kept = line => KEPT.test(lines[line - 1] ?? '') || /^\s*\/\/\s*en-kept:/.test(lines[line - 2] ?? '');
  const found = [];
  const visit = node => {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = exempt(node) ? null : node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    if (text !== null) {
      const line = lineOf(sf, node);
      const hits = pieces(text).filter(english);
      if (hits.length && !kept(line)) found.push({ line, text: hits.join(' | ') });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// every words call: its key when it is a literal, and whether it runs when the module loads (no function around it)
export function wordsCalls(source, file = 'source.js') {
  const sf = parse(source, file);
  const calls = [];
  const visit = (node, inFunction) => {
    if (isWordsCall(node)) {
      const arg = node.arguments[0];
      const key = arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : null;
      calls.push({ line: lineOf(sf, node), fn: node.expression.text, key, topLevel: !inFunction });
    }
    const inner = inFunction || ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
    ts.forEachChild(node, child => visit(child, inner));
  };
  visit(sf, false);
  return calls;
}
