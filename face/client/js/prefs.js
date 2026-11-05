// gravit-ui/js/prefs.js — the text and code sizes and the two font families (spec D31): each kept in the browser's prefs,
// read back in range, and set as the custom properties tokens.css and app.css read (--fs, --fm, --font-sans, --font-mono).
// index.html's inline script sets the same before the first paint (prefs.test.js holds the two to each other).

export const SIZES = { textSize: { min: 12, max: 20, base: 15 }, codeSize: { min: 10, max: 16, base: 12 } };

// a whole px in its range; the base for anything that is not a finite number
export function sizeOf(name, v) {
  const r = SIZES[name];
  if (!r) return null;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, Math.round(v))) : r.base;
}

// a family name and nothing else: letters, digits, spaces, _ . and -, every other character a space, the spaces collapsed,
// at most 64 characters; '' for anything not a string (the default family)
export function cleanFont(v) {
  if (typeof v !== 'string') return '';
  return [...v.replace(/[^\p{L}\p{N} _.-]/gu, ' ').replace(/ +/g, ' ').trim()].slice(0, 64).join('').trim();
}

// each property's value, null at its default
export function cssOf(prefs) {
  const p = prefs ?? {};
  const fs = sizeOf('textSize', p.textSize);
  const fm = sizeOf('codeSize', p.codeSize);
  const sans = cleanFont(p.textFont);
  const mono = cleanFont(p.codeFont);
  return {
    '--fs': fs === SIZES.textSize.base ? null : String(fs / SIZES.textSize.base),
    '--fm': fm === SIZES.codeSize.base ? null : String(fm / SIZES.codeSize.base),
    '--font-sans': sans ? `"${sans}", var(--font-sans-base)` : null,
    '--font-mono': mono ? `"${mono}", var(--font-mono-base)` : null,
  };
}

// on the page's root: each value set, each default removed (so tokens.css's own stands)
export function applyPrefs(rootEl, prefs) {
  const style = rootEl?.style;
  if (!style) return;
  for (const [name, value] of Object.entries(cssOf(prefs))) {
    if (value === null) style.removeProperty(name); else style.setProperty(name, value);
  }
}
