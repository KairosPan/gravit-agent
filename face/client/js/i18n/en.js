// gravit-ui/js/i18n/en.js — the face's own words in English, exactly as the screens draw them (spec §5.10). Keys are
// `<area>.<part>.<name>` in lower camel; a value is plain text (no markup, no entity) with `{name}` params, or a plural
// `{ one, other }` whose other holds `{n}`. words-table.test.js holds the grammar, and that every key is used.
export const EN = Object.freeze({
  // a control word with one meaning everywhere
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.no': 'No',

  // clocks, days and ages (time.js)
  'time.today': 'Today',
  'time.yesterday': 'Yesterday',
  'time.justNow': 'Just now',
  'time.month.jan': 'Jan',
  'time.month.feb': 'Feb',
  'time.month.mar': 'Mar',
  'time.month.apr': 'Apr',
  'time.month.may': 'May',
  'time.month.jun': 'Jun',
  'time.month.jul': 'Jul',
  'time.month.aug': 'Aug',
  'time.month.sep': 'Sep',
  'time.month.oct': 'Oct',
  'time.month.nov': 'Nov',
  'time.month.dec': 'Dec',
  'time.ago.minutes': { one: '{n} minute ago', other: '{n} minutes ago' },
  'time.ago.hours': { one: '{n} hour ago', other: '{n} hours ago' },
  'time.ago.days': { one: '{n} day ago', other: '{n} days ago' },
});
