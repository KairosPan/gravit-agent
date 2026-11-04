// The golden's writer (not a test): --pin writes fixtures/screens-en.json, each corpus entry's sha256 by its name, in corpus
// order; --dump <dir> writes <dir>/<name>.html for each entry, to diff a change's before and after.
//   npx tsx tests/client/golden-write.js --pin
//   npx tsx tests/client/golden-write.js --dump <dir>
// The zone is set before the corpus is read, as words-golden.test.js sets it.
process.env.TZ = 'America/New_York';
const { writeFileSync, mkdirSync } = await import('node:fs');
const { join, resolve } = await import('node:path');
const { createHash } = await import('node:crypto');
const { corpus } = await import('./helpers/screens.js');

const [flag, dir] = process.argv.slice(2);
const entries = corpus();
if (flag === '--pin') {
  const pinned = Object.fromEntries(entries.map(([name, html]) => [name, createHash('sha256').update(html).digest('hex')]));
  writeFileSync(new URL('./fixtures/screens-en.json', import.meta.url), JSON.stringify(pinned, null, 2) + '\n');
  console.log(`pinned ${entries.length} states in tests/client/fixtures/screens-en.json`);
} else if (flag === '--dump' && dir) {
  mkdirSync(resolve(dir), { recursive: true });
  for (const [name, html] of entries) writeFileSync(join(resolve(dir), `${name}.html`), html);
  console.log(`dumped ${entries.length} states into ${resolve(dir)}`);
} else {
  console.error('usage: npx tsx tests/client/golden-write.js --pin | --dump <dir>');
  process.exit(2);
}
