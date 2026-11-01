// face/client/js/render/markdown.js — Gravit's markdown renderer, set once: the app hands in the DOM-built renderer
// (wire/markdown.js) at boot, tests a stub, and with none set the text is escaped. The thread and a composed answer's
// summary both draw through it (its own module, so render/thread.js and render/lunhui/composed.js need not import each other).
import { esc } from '../html.js';

let markdown = null;
export function setMarkdown(fn) { markdown = typeof fn === 'function' ? fn : null; }
// any markdown the screens draw (a message, a channel's thesis, a composed answer's summary), escaped when none is set
export const markdownHtml = text => (markdown ? markdown(text ?? '') : esc(text ?? ''));
