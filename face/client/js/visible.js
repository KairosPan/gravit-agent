// face/client/js/visible.js — words that came from the memory or the face, made visible before they are escaped: the set
// is the memory package's own (gravit-memory's UNSEEN: every format character - bidi marks, embeddings, overrides and
// isolates, zero-width spaces and joiners, the byte-order mark, tag characters -, the line and paragraph separators) with
// the C0 and C1 controls and DEL, a tab left alone. Each is written as its escape, \uXXXX, or \u{XXXXX} in lower-case hex
// above U+FFFF, so nothing hides or reorders what the card says. The result is still text: the caller escapes it (html.js
// esc) before it becomes markup.

const HIDDEN = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu;

export function visible(text) {
  return String(text ?? '').replace(HIDDEN, c => {
    const cp = c.codePointAt(0);
    return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
  });
}
