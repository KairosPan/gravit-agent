// face/client/js/host/search-view.js — the side panel's search (plan 2 of the dsh UI port; render/side.js). Pure: no DOM, no store.
// A query matches in two places: the titles the list already holds (at once, no wire) and the words inside the
// conversations (GET /data/search). This merges the two into one list of at most twenty, title matches first, and names
// the phase the panel is in. An item whose session the list does not hold is dropped (D1); a title match with no content
// hit shows its preview line (D2). The preview is taken from the host's one-message page (conv.preview), else the last
// spoken message's text, without its sender's name.
import { channelLabel } from './rail-view.js';
import { isDeskPreset } from '../wire/speaker.js';
import { attachmentsLine } from '../composer/files.js';
import { t } from '../i18n/words.js';

export const SEARCH_ITEMS = 20;

const attachmentsOf = m => (Array.isArray(m.data?.attachments) ? m.data.attachments : []);
/** A line someone said: not a context row or a tool row, with words or attachments (an image sent alone counts). */
export const spoken = m => m.from !== 'system' && m.kind !== 'tool' && typeof m.text === 'string' && (m.text !== '' || attachmentsOf(m).length > 0);
/** A spoken line's preview: its words, or with none its attachments' names. */
export const spokenLine = m => (m.text !== '' ? m.text : attachmentsLine(attachmentsOf(m)));

const labelFor = (conv, channels) => {
  if (isDeskPreset(conv.preset)) return t('list.desk');
  if (!conv.channel) return t('list.noChannel');
  const known = (channels ?? []).find(ch => ch.workspaceId === conv.channel.workspaceId);
  return known ? channelLabel(known) : conv.channel.name;
};

const previewLine = conv => {
  if (typeof conv.preview === 'string' && conv.preview !== '') return conv.preview;
  const m = (conv.messages ?? []).findLast(spoken);
  return m ? spokenLine(m) : '';
};

const itemOf = (conv, channels, over) => ({
  id: conv.id, title: conv.title, channelLabel: labelFor(conv, channels), at: conv.updatedAt ?? 0,
  archived: conv.archived || false, snippet: previewLine(conv), ...over,
});

// [{id, title, channelLabel, at, archived, snippet}] - newest first, case-insensitive substring on title or channel label
export function titleMatches(conversations, channels, q) {
  const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (needle === '') return [];
  return (conversations ?? [])
    .filter(c => `${c.title ?? ''}`.toLowerCase().includes(needle) || labelFor(c, channels).toLowerCase().includes(needle))
    .map(c => itemOf(c, channels, {}))
    .sort((a, b) => b.at - a.at);
}

// one list of at most 20: title matches first (a content hit on one gives it that snippet and match), then the content
// items whose session is a listed conversation and not already shown
export function mergeResults({ titles, content, conversations, channels }) {
  const byId = new Map((conversations ?? []).map(c => [c.id, c]));
  const hits = new Map();
  for (const h of content ?? []) if (!hits.has(h.sessionId)) hits.set(h.sessionId, h);
  const out = [];
  const seen = new Set();
  for (const title of titles ?? []) {
    if (seen.has(title.id)) continue;
    seen.add(title.id);
    const h = hits.get(title.id);
    out.push(h ? { ...title, snippet: h.snippet, match: h.match ?? null } : { ...title, match: null });
  }
  for (const h of content ?? []) {
    const conv = byId.get(h.sessionId);
    if (!conv || seen.has(conv.id)) continue;
    seen.add(conv.id);
    out.push(itemOf(conv, channels, { snippet: h.snippet, match: h.match ?? null }));
  }
  // the array is the items; a non-enumerable `overflow` says whether more than twenty were cut
  const items = out.slice(0, SEARCH_ITEMS);
  Object.defineProperty(items, 'overflow', { value: out.length > SEARCH_ITEMS });
  return items;
}

// [{text, mark}] for a snippet and a [start, end] match; a missing or out-of-range match is one unmarked run
export function highlightRuns(snippet, match) {
  const s = typeof snippet === 'string' ? snippet : '';
  if (s === '') return [];
  const ok = Array.isArray(match) && match.length === 2 && Number.isInteger(match[0]) && Number.isInteger(match[1])
    && match[0] >= 0 && match[0] < match[1] && match[1] <= s.length;
  if (!ok) return [{ text: s, mark: false }];
  const [a, b] = match;
  return [{ text: s.slice(0, a), mark: false }, { text: s.slice(a, b), mark: true }, { text: s.slice(b), mark: false }].filter(r => r.text !== '');
}

// 'idle' | 'searching' | 'results' | 'empty' | 'failed' - a failed content search keeps the title matches
export function searchPhase({ query, contentPhase, merged }) {
  if (typeof query !== 'string' || query.trim() === '') return 'idle';
  if ((merged ?? []).length > 0) return 'results';
  if (contentPhase === 'failed') return 'failed';
  if (contentPhase === 'done') return 'empty';
  return 'searching';
}

// true when the wire said hasMore or the merge cut items past twenty (exactly twenty is not more)
export const moreThanTwenty = (merged, hasMore) => hasMore === true || merged?.overflow === true;
