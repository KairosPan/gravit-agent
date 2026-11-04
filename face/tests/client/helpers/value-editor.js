// face/tests/client/helpers/value-editor.js — the composer's editor (host.editor) over a fake element's value, for the
// app-dom tests: the fake DOM parses no HTML, so #say is an INPUT or TEXTAREA whose words are its value. A test sets
// `el.chips` (an array of chips) to make read() add them after the words.
import { plainText } from '../../../client/js/composer/draft.js';

export const valueEditor = {
  read: el => [...(el.value ? [{ type: 'text', text: el.value }] : []), ...(el.chips ?? []).map(chip => ({ type: 'chip', chip }))],
  caret: el => el.selectionStart,
  place: (el, at) => el.setSelectionRange(at, at),
  write(el, runs, at) {
    el.value = plainText(runs);
    if (at != null) el.setSelectionRange(at, at);
  },
};
