// gravit-ui/js/i18n/zh.js — the face's own words in Chinese (中文), the second table of spec §5.10 (plan 7). It holds the same keys as
// en.js, `<area>.<part>.<name>`, and a value is a plain string with the same `{name}` params as its English one: no plural
// object, because Chinese has one form (a plural's `{n}` stays in the string). A key this table lacks reads from EN (words.js).
// tests/client/fixtures/zh-glossary.json is what it is written against (the register, the terms, the names that stay Latin);
// words-zh.test.js holds it to that and to the table grammar. Empty until the table is written (plan 7 Task 8).
export const ZH = Object.freeze({});
