// The golden's writer (not a test). The golden is append-only: a pin keeps every name it holds, in its order, and its hash,
// and adds the names it lacks (a state is added after the last state, so no pinned state changes name); a state a change redraws on purpose is re-pinned by name, so a review sees which.
//   npx tsx tests/client/golden-write.js --pin                     add the entries not pinned yet (all of them, on a first pin)
//   npx tsx tests/client/golden-write.js --pin --repin a,b,…       and take the named entries' new hashes
//   npx tsx tests/client/golden-write.js --dump <dir>              write <dir>/<name>.html for each entry, to diff a before and after
//   … --lang zh                                                    the same over the corpus drawn under ZH, fixtures/screens-zh.json
// The zone is set before the corpus is read, as words-golden.test.js sets it.
process.env.TZ = 'America/New_York';
const { writeFileSync, readFileSync, existsSync, mkdirSync } = await import('node:fs');
const { join, resolve } = await import('node:path');
const { createHash } = await import('node:crypto');
const { goldenEntries } = await import('./helpers/screens.js');
const { tableOf, langOf } = await import('../../client/js/i18n/langs.js');
const { setTable } = await import('../../client/js/i18n/words.js');
const { EN } = await import('../../client/js/i18n/en.js');

const all = process.argv.slice(2);
const at = all.indexOf('--lang');
const lang = at >= 0 ? langOf(all[at + 1]) : 'en';
if (at >= 0 && all[at + 1] !== lang) { console.error(`--lang ${all[at + 1] ?? ''}: en or zh`); process.exit(2); }
const args = at >= 0 ? [...all.slice(0, at), ...all.slice(at + 2)] : all;
const FIXTURE = new URL(`./fixtures/screens-${lang}.json`, import.meta.url);
const flag = args[0];
// the corpus under the language's table (set for the whole read: hostCorpus awaits), then the table before
setTable(tableOf(lang));
const entries = await goldenEntries().finally(() => setTable(EN));
const sha = html => createHash('sha256').update(html).digest('hex');

if (flag === '--pin') {
  const at = args.indexOf('--repin');
  const repin = new Set(at >= 0 ? (args[at + 1] ?? '').split(',').filter(Boolean) : []);
  const pinned = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};
  const old = Object.keys(pinned);
  const names = entries.map(([name]) => name);
  const problems = [];
  // append-only: every pinned name is still in the corpus, in the order pinned (new names may fall between kinds: a new state
  // after the states, before the composer's pieces); a state put between two others shifts the names after it, and their
  // hashes, so it is refused below unless each is re-pinned
  const kept = names.filter(name => Object.hasOwn(pinned, name));
  for (const name of old) if (!names.includes(name)) problems.push(`${name} is pinned but no longer in the corpus`);
  if (kept.join() !== old.filter(name => names.includes(name)).join()) problems.push('the pinned names are in another order in the corpus');
  for (const name of repin) if (!Object.hasOwn(pinned, name)) problems.push(`--repin ${name}: no such pinned entry`);
  const next = {};
  const changed = [];
  for (const [name, html] of entries) {
    const hash = sha(html);
    if (Object.hasOwn(pinned, name) && pinned[name] !== hash) {
      if (repin.has(name)) changed.push(name);
      else problems.push(`${name} renders other bytes: re-pin it by name (--repin ${name}) if the change is meant`);
    }
    next[name] = Object.hasOwn(pinned, name) && !repin.has(name) ? pinned[name] : hash;
  }
  if (problems.length) {
    console.error(`nothing written:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  writeFileSync(FIXTURE, JSON.stringify(next, null, 2) + '\n');
  console.log(`pinned ${entries.length} entries: ${entries.length - old.length} added, ${changed.length} re-pinned${changed.length ? ` (${changed.join(', ')})` : ''}`);
} else if (flag === '--dump' && args[1]) {
  const dir = resolve(args[1]);
  mkdirSync(dir, { recursive: true });
  for (const [name, html] of entries) writeFileSync(join(dir, `${name}.html`), html);
  console.log(`dumped ${entries.length} entries into ${dir}`);
} else {
  console.error('usage: npx tsx tests/client/golden-write.js --pin [--repin name,…] | --dump <dir> [--lang en|zh]');
  process.exit(2);
}
