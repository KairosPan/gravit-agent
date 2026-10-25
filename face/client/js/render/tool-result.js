// face/client/js/render/tool-result.js — a tool row's result drawn for reading (spec 2026-10-19 §6, the `card` row). No
// server's result is dressed: the alpaca-kit renderers left with alpaca-kit (stage 3 of the Account graft), so every result —
// one in a conversation written before then included — takes the plain row the thread draws: the call's name, its payload
// folded under it. The seam stays, so a server's result can be dressed again by its name.

// the dressed HTML for a call's result, or null for the plain row: null for every call today
export function toolResultHtml(name, text) {
  return null;
}

// the thread asks per message; an error result is never dressed
export function toolResultFor(data) {
  if (data === null || typeof data !== 'object' || data.isError) return null;
  return toolResultHtml(data.name, data.result);
}
