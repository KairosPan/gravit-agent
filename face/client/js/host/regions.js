// iMessage's sheet 1: the country or region a number is from, picked from a list, and the number typed as it is dialled there.
// Each entry is a region's ISO 3166 code and its calling code; names come from the browser (Intl.DisplayNames), in the page's language.

/** [ISO code, calling code] for the regions sheet 1 offers. */
export const REGIONS = [
  ['US', '1'], ['CA', '1'], ['CN', '86'], ['HK', '852'], ['MO', '853'], ['TW', '886'], ['SG', '65'], ['MY', '60'],
  ['JP', '81'], ['KR', '82'], ['TH', '66'], ['VN', '84'], ['PH', '63'], ['ID', '62'], ['IN', '91'], ['AE', '971'],
  ['SA', '966'], ['IL', '972'], ['TR', '90'], ['GB', '44'], ['IE', '353'], ['DE', '49'], ['FR', '33'], ['IT', '39'],
  ['ES', '34'], ['PT', '351'], ['NL', '31'], ['BE', '32'], ['CH', '41'], ['AT', '43'], ['SE', '46'], ['NO', '47'],
  ['DK', '45'], ['FI', '358'], ['PL', '48'], ['RU', '7'], ['UA', '380'], ['AU', '61'], ['NZ', '64'], ['BR', '55'],
  ['MX', '52'], ['AR', '54'], ['CL', '56'], ['CO', '57'], ['ZA', '27'], ['NG', '234'], ['EG', '20'],
];
const DIAL = new Map(REGIONS);
/** The region sheet 1 starts on when the browser's language names none of the list. */
export const DEFAULT_REGION = 'US';

/** Whether `iso` is one of the list's regions. */
export const isRegion = iso => typeof iso === 'string' && DIAL.has(iso);

/** The region a browser language tag names (`zh-CN` → CN, `en-GB` → GB), or the default; a bare `zh` reads as CN. */
export function regionOfLocale(tag) {
  const parts = typeof tag === 'string' ? tag.split(/[-_]/) : [];
  const named = parts.slice(1).find(p => /^[A-Za-z]{2}$/.test(p))?.toUpperCase();
  if (isRegion(named)) return named;
  return parts[0]?.toLowerCase() === 'zh' ? 'CN' : DEFAULT_REGION;
}

/** The full number (E.164) from a region and the number as typed: spaces, dashes, dots and parentheses go, one leading 0 (the
 *  trunk prefix most regions dial at home) goes too, except in Italy, where it is part of the number; a number typed with its
 *  own + is taken as it stands, whatever the region. */
export function phoneFrom(region, typed) {
  const s = typeof typed === 'string' ? typed.trim().replace(/[\s().-]/g, '') : '';
  if (s.startsWith('+')) return s;
  const dial = DIAL.get(region);
  if (!dial || !/^\d+$/.test(s)) return '';
  const national = region === 'IT' ? s : s.replace(/^0/, '');
  return `+${dial}${national}`;
}

/** The list as sheet 1 draws it: each region's name in `lang` and its calling code, sorted by name. */
export function regionOptions(lang) {
  // a tag the browser cannot read (none, or a test's wrapped word) is English
  let names;
  try { names = new Intl.DisplayNames([lang || 'en'], { type: 'region' }); } catch { lang = 'en'; names = new Intl.DisplayNames(['en'], { type: 'region' }); }
  const nameOf = iso => { try { return names?.of(iso) || iso; } catch { return iso; } };
  return REGIONS.map(([iso, dial]) => ({ iso, dial, name: nameOf(iso) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang || 'en'));
}
