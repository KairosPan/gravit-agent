// iMessage's region list (host/regions.js): the region a browser names, the full number from a region and the typed number, the list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, regionOfLocale, phoneFrom, regionOptions, isRegion, DEFAULT_REGION } from '../../client/js/host/regions.js';

test('a browser language names its region, or the default', () => {
  assert.equal(regionOfLocale('zh-CN'), 'CN');
  assert.equal(regionOfLocale('en-GB'), 'GB');
  assert.equal(regionOfLocale('zh-Hant-TW'), 'TW');
  assert.equal(regionOfLocale('zh'), 'CN');
  assert.equal(regionOfLocale('en'), DEFAULT_REGION);
  assert.equal(regionOfLocale('xx-QQ'), DEFAULT_REGION);
  assert.equal(regionOfLocale(undefined), DEFAULT_REGION);
});

test('the full number: the calling code, the trunk 0 dropped but in Italy, a typed + as it stands, nothing from junk', () => {
  assert.equal(phoneFrom('US', '(415) 555-0100'), '+14155550100');
  assert.equal(phoneFrom('CN', '138 0013 8000'), '+8613800138000');
  assert.equal(phoneFrom('GB', '07700 900123'), '+447700900123');
  assert.equal(phoneFrom('IT', '06 1234 5678'), '+390612345678');
  assert.equal(phoneFrom('JP', '+81 90 1234 5678'), '+819012345678');
  assert.equal(phoneFrom('US', 'call me'), '');
  assert.equal(phoneFrom('ZZ', '4155550100'), '');
  assert.equal(phoneFrom('US', ''), '');
});

test('the list: every region once, sorted by its name in the language asked for', () => {
  assert.equal(new Set(REGIONS.map(r => r[0])).size, REGIONS.length);
  assert.ok(REGIONS.every(([iso, dial]) => isRegion(iso) && /^[1-9]\d{0,2}$/.test(dial)));
  const en = regionOptions('en').map(o => o.name);
  assert.deepEqual(en, [...en].sort((a, b) => a.localeCompare(b, 'en')));
  assert.equal(regionOptions('zh-CN').find(o => o.iso === 'CN').name, '中国');
});
