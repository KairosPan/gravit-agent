// Apply the operator's corrections (plan 7 Task 14):
//   npx tsx tests/client/zh-apply.js <tsv>
// Each row with a non-empty fix becomes that key's ZH value (\t and \n decoded). A key zh.js lacks, a fix whose {params}
// differ from the English key's, or a fix the table grammar refuses (empty, <, >, ", or an HTML entity) is named, and the
// run writes nothing. Otherwise zh.js is rewritten in place: keys, order and comments kept, each changed value one
// single-quoted literal. Prints the keys changed.
const { readFileSync, writeFileSync } = await import('node:fs');
const { resolve } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { parseTsv } = await import('./zh-review.js');
const { params, forms, ENTITY } = await import('./helpers/words-table.js');

const ZH_FILE = fileURLToPath(new URL('../../client/js/i18n/zh.js', import.meta.url));

const sameParams = (fix, enValue) => {
  const got = [...params(fix)].sort();
  const want = [...new Set(forms(enValue).flatMap(params))].sort();
  return got.length === want.length && got.every((p, i) => p === want[i]);
};

const grammarOf = fix => {
  if (typeof fix !== 'string' || fix === '') return 'empty';
  if (/[<>"]/.test(fix)) return 'holds <, > or "';
  if (ENTITY.test(fix)) return 'holds an HTML entity';
  return '';
};

const literal = value => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Rewrite file from the TSV text. Returns the keys changed. Throws, writing nothing, when any fix is refused. */
export function applyFixes(tsv, file, en) {
  const rows = parseTsv(tsv).filter(r => r.fix !== '');
  const problems = [];
  for (const row of rows) {
    if (!Object.hasOwn(en, row.key)) { problems.push(`${row.key}: not a key`); continue; }
    const why = grammarOf(row.fix);
    if (why) problems.push(`${row.key}: ${why}`);
    else if (!sameParams(row.fix, en[row.key])) problems.push(`${row.key}: params differ from its English`);
  }
  if (problems.length) throw new Error(`nothing written:\n  ${problems.join('\n  ')}`);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const changed = [];
  for (const row of rows) {
    const at = lines.findIndex(line => line.startsWith(`  '${row.key}': `));
    if (at < 0) problems.push(`${row.key}: no line in ${file}`);
    else {
      const next = `  '${row.key}': ${literal(row.fix)},`;
      if (lines[at] !== next) { lines[at] = next; changed.push(row.key); }
    }
  }
  if (problems.length) throw new Error(`nothing written:\n  ${problems.join('\n  ')}`);
  const out = lines.join('\n');
  if (out !== text) writeFileSync(file, out);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tsvPath = process.argv[2];
  if (!tsvPath) { console.error('usage: npx tsx tests/client/zh-apply.js <tsv>'); process.exit(2); }
  const { EN } = await import('../../client/js/i18n/en.js');
  try {
    const changed = applyFixes(readFileSync(resolve(tsvPath), 'utf8'), ZH_FILE, EN);
    console.log(changed.length ? changed.join('\n') : 'no key changed');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
