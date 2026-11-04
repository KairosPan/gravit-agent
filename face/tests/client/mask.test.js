// The masking module (plan 5 task 1, spec §5.9, D25, A2): js/mask.js's runs and excerpts — every shape keeps its first
// eight characters, a private-key block its armour lines, a URL its user; the clip rule for an excerpt cut by its
// ellipsis; display only, so the originals ride the runs untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEP, maskSpans, maskExcerpt } from '../../client/js/mask.js';

const fill = (pattern, n) => pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n);
const secrets = text => maskSpans(text).filter(run => run.type === 'secret');
const kept = text => text.slice(0, KEEP) + '*'.repeat(text.length - KEEP);

const SAMPLES = {
  sk: 'sk-proj-' + fill('aB3dE6', 24),
  aiza: 'AIza' + fill('Sy9_x-Q', 35),
  ghp: 'ghp_' + fill('aB3dE6', 36),
  ghs: 'ghs_' + fill('Zx9', 40),
  githubPat: 'github_pat_' + fill('11AB_cd', 30),
  glpat: 'glpat-' + fill('aB3-x_', 20),
  npm: 'npm_' + fill('aB3dE6', 36),
  hf: 'hf_' + fill('aB3dE6', 30),
  akia: 'AKIA' + fill('Q7XZ', 16),
  asia: 'ASIA' + fill('W2PM', 16),
  ltai: 'LTAI' + fill('5tK9wq', 14),
  akid: 'AKID' + fill('mN4pQ', 13),
  slack: 'xoxb-' + fill('1234-abcD', 24),
  stripeLive: 'sk_live_' + fill('aB3dE6', 24),
  stripeTest: 'rk_test_' + fill('aB3dE6', 16),
  whsec: 'whsec_' + fill('aB3+/=', 32),
  jwt: 'eyJ' + fill('hbGciOi', 12) + '.eyJ' + fill('zdWIiOi', 20) + '.' + fill('SflKx_w-', 24),
  telegram: '123456789:' + fill('AAHk_9-x', 35),
  alpaca: 'PK' + fill('7QZ3XW', 18),
};

test('each prefix shape keeps 8 characters and masks the rest, one asterisk per character', () => {
  assert.equal(KEEP, 8);
  for (const [name, text] of Object.entries(SAMPLES)) {
    const runs = maskSpans(text);
    assert.equal(runs.length, 1, name);
    assert.equal(runs[0].type, 'secret', name);
    assert.equal(runs[0].text, text, name);
    assert.equal(runs[0].masked.length, text.length, name);
    assert.equal(runs[0].masked.slice(0, 8), text.slice(0, 8), name);
    assert.equal(runs[0].masked, kept(text), name);
  }
});

test('sk- needs 20 characters with a digit', () => {
  assert.deepEqual(secrets('sk-abcdefghijklmnopqrstuv'), []);
  assert.deepEqual(secrets('sk-abc123'), []);
  assert.equal(secrets('sk-abcdefghijklmnopqrst1').length, 1);
});

test('a JWT, a Telegram token and an Alpaca key id are masked; a 17-character PK… is not', () => {
  for (const text of [SAMPLES.jwt, SAMPLES.telegram, SAMPLES.alpaca, 'AK' + fill('9WQ', 18)]) {
    assert.equal(secrets(`token ${text} here`).length, 1, text);
  }
  assert.deepEqual(secrets('PK' + fill('7QZ3XW', 15)), []);
  assert.deepEqual(secrets('PK' + fill('7QZ3XW', 17)), []);
  assert.deepEqual(secrets('1234567:' + fill('AAHk_9-x', 35)), [], 'seven digits are short of the bot id');
  assert.deepEqual(secrets('eyJhbGciOi.eyJzdWIiOi'), [], 'two segments are not a JWT');
});

test('a private-key block keeps its BEGIN and END lines and its line breaks', () => {
  const begin = '-----BEGIN RSA PRIVATE KEY-----';
  const end = '-----END RSA PRIVATE KEY-----';
  const body = 'MIIEowIBAAKCAQEA\r\nq1w2e3r4t5y6\n';
  const text = `key:\n${begin}\n${body}${end}\nthanks`;
  const runs = maskSpans(text);
  assert.deepEqual(runs.map(run => run.type), ['text', 'secret', 'text']);
  const [, block] = runs;
  assert.equal(block.text, `${begin}\n${body}${end}`);
  assert.equal(block.masked, `${begin}\n${'*'.repeat(16)}\r\n${'*'.repeat(12)}\n${end}`);
  assert.equal(block.masked.length, block.text.length);
  assert.deepEqual(secrets('-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----'), []);
});

test('a URL password is masked whole and the user kept', () => {
  assert.equal(maskExcerpt('postgres://app:hunter2@db/x'), 'postgres://app:*******@db/x');
  const runs = maskSpans('see postgres://app:hunter2@db/x');
  assert.deepEqual(runs, [
    { type: 'text', text: 'see postgres://app:' },
    { type: 'secret', text: 'hunter2', masked: '*******' },
    { type: 'text', text: '@db/x' },
  ]);
  assert.deepEqual(secrets('https://example.com:8080/path'), [], 'a port is no password');
});

test('password=… and a password in prose are not masked', () => {
  for (const text of ['password=hunter2', 'my password is hunter2', 'PASSWORD: hunter2', 'user:hunter2@host']) {
    assert.deepEqual(secrets(text), [], text);
    assert.equal(maskExcerpt(text), text, text);
  }
});

test('a key inside a longer word is not masked, one beside punctuation is', () => {
  assert.deepEqual(secrets('x' + SAMPLES.sk), []);
  assert.deepEqual(secrets(SAMPLES.akia + 'Z'), [], 'a fixed-length body followed by more is no key');
  const runs = maskSpans(`(${SAMPLES.sk})`);
  assert.deepEqual(runs.map(run => run.type), ['text', 'secret', 'text']);
  assert.equal(runs[0].text, '(');
  assert.equal(runs[1].text, SAMPLES.sk);
  assert.equal(runs[2].text, ')');
  assert.equal(secrets(`"${SAMPLES.ghp}",`).length, 1);
});

test('maskSpans gives text and secret runs in order, the originals untouched', () => {
  const text = `first ${SAMPLES.sk} then ${SAMPLES.npm} and postgres://u:pw@h end`;
  const runs = maskSpans(text);
  assert.deepEqual(runs.map(run => run.type), ['text', 'secret', 'text', 'secret', 'text', 'secret', 'text']);
  assert.equal(runs.map(run => run.text).join(''), text);
  assert.equal(runs[1].text, SAMPLES.sk);
  assert.equal(runs[3].text, SAMPLES.npm);
  assert.equal(runs[5].text, 'pw');
  assert.deepEqual(maskSpans('nothing here'), [{ type: 'text', text: 'nothing here' }]);
  assert.deepEqual(maskSpans(''), []);
});

test('maskExcerpt keeps the length for every shape and for a text with none', () => {
  for (const [name, sample] of Object.entries(SAMPLES)) {
    const text = `a ${sample} b`;
    const masked = maskExcerpt(text);
    assert.equal(masked.length, text.length, name);
    assert.equal(masked, `a ${kept(sample)} b`, name);
  }
  assert.equal(maskExcerpt('plain words, no keys'), 'plain words, no keys');
  assert.equal(maskExcerpt(''), '');
});

test("the clip rule masks a key cut by the trailing ellipsis below its shape's minimum", () => {
  assert.equal(maskExcerpt('… key sk-proj-12ab…'), '… key sk-proj-****…');
  assert.equal(maskExcerpt('… key sk-proj-12ab'), '… key sk-proj-12ab', 'no ellipsis, no clip');
  assert.equal(maskExcerpt('key sk-12ab…'), 'key sk-****…', 'a token of 8 or fewer keeps its prefix alone');
  assert.equal(maskExcerpt('see (ghp_aB3dE6xy…'), 'see (ghp_aB3d****…', 'leading punctuation is not the token');
  assert.equal(maskExcerpt('tok eyJhbGciOiJIUzI1…'), 'tok eyJhbGci********…');
  assert.equal(maskExcerpt('ask the desk…'), 'ask the desk…');
  assert.equal(maskExcerpt('xsk-proj-12ab…'), 'xsk-proj-12ab…', 'inside a longer word, no clip');
  const snippet = '… pasted ' + SAMPLES.sk.slice(0, 15) + '…';
  assert.equal(maskExcerpt(snippet).length, snippet.length);
  // maskSpans is the bubble's form and never clips
  assert.deepEqual(secrets('… key sk-proj-12ab…'), []);
});

test('the same text twice returns the same runs (memoized)', () => {
  const text = `memo ${SAMPLES.hf}`;
  assert.equal(maskSpans(text), maskSpans(text));
  for (let i = 0; i < 600; i += 1) maskSpans(`filler ${i}`);
  const again = maskSpans(text);
  assert.deepEqual(again, maskSpans(text));
  assert.equal(again[1].text, SAMPLES.hf);
});
