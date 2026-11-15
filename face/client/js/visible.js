// face/client/js/visible.js — words that came from the memory or the face, made visible before they are escaped: a control
// character (a tab aside), a bidi mark, embedding, override or isolate, a zero-width space or joiner, a line or paragraph
// separator and a byte-order mark are each written as the six characters \uXXXX, so nothing hides or reorders what the card
// says. The result is still text: the caller escapes it (html.js esc) before it becomes markup.

const HIDDEN = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

export function visible(text) {
  return String(text ?? '').replace(HIDDEN, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
