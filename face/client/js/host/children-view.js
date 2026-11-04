// face/client/js/host/children-view.js — a conversation's subagent children (spec 2026-10-19 §7 Stage 3 "Research
// surfaces", the dock in its minimal form). Pure. The parent's subagentCatalog projection, composed with the list's
// child rows the old client's way (wire/subagents.js): a malformed catalog is unavailable, never an empty list; an
// unknown-mode entry is shown and never controllable.
import { composeSubagentCatalog, normalizeSubagentCatalog, subagentControls } from '../wire/subagents.js';
import { t } from '../i18n/words.js';

// {children: [{id, label, mode, state: 'running'|'inactive'|'unknown'|'unavailable', canStop}], unavailable}
export function childrenOf(conv, childRows = []) {
  if (!conv || conv.subagentCatalog === undefined) return { children: [], unavailable: false };
  let catalog;
  try {
    catalog = normalizeSubagentCatalog(composeSubagentCatalog({
      catalog: conv.subagentCatalog, parentSummary: { agentAvailable: conv.live === true }, rows: Array.isArray(childRows) ? childRows : [],
    }));
  } catch {
    return { children: [], unavailable: true };
  }
  return {
    unavailable: false,
    children: catalog.entries.map(e => {
      const c = subagentControls(e, catalog.parentAvailable);
      const child = e.kind === 'child';
      return { id: e.id, label: child ? e.label : t('details.subagent'), mode: child ? e.mode : null, state: c.state, canStop: c.canInterrupt };
    }),
  };
}
