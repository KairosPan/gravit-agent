// The composer's menus' items, pure: what the / and @ menus list for a query, in drawn order, and the chip a pick becomes.
//   Menu = {kind: '/' | '@', from, query, groups: [{label?, crumb?, items}], active}
import { ago } from '../time.js';
import { t } from '../i18n/words.js';

export const HIDDEN_COMMANDS = ['plan', 'permission', 'feedback'];   // D11
export const CONVERSATION_ITEMS = 8;

/** Items whose key holds the query's letters in order, case-insensitive; prefix matches first, input order within a tier. */
export function rankByLetters(items, query, keyOf) {
  const q = String(query ?? '').toLowerCase();
  if (!q) return items.slice();
  const prefix = [], rest = [];
  for (const it of items) {
    const key = String(keyOf(it) ?? '').toLowerCase();
    if (key.startsWith(q)) { prefix.push(it); continue; }
    let at = 0;
    for (const ch of key) if (ch === q[at]) at++;
    if (at === q.length) rest.push(it);
  }
  return [...prefix, ...rest];
}

const capitalize = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function slashItems({ commands, skills, query, atStart }) {
  const groups = [];
  if (commands != null) {
    const items = commands
      .filter(c => !HIDDEN_COMMANDS.includes(c.name))
      .filter(c => !c.input || atStart)
      .map(c => ({
        kind: 'command', name: c.name, title: capitalize(c.name), description: c.description ?? '',
        takesArgs: !!c.input, hint: c.input?.hint ?? '',
      }));
    groups.push({ label: t('composer.menu.commands'), items: rankByLetters(items, query, i => i.name) });
  }
  const sk = (skills ?? []).map(s => ({ kind: 'skill', name: s.name, description: s.description ?? '' }));
  groups.push({ label: t('composer.menu.skills'), items: rankByLetters(sk, query, i => i.name) });
  return groups
    .filter(g => g.items.length)
    .map(g => (query ? { items: g.items } : g));
}

const fileItem = f => {
  const path = String(f.path).replace(/\/+$/, '');
  const cut = path.lastIndexOf('/');
  return { kind: 'file', path: f.path, dir: f.kind === 'directory', name: path.slice(cut + 1), folder: cut < 0 ? '' : path.slice(0, cut) };
};

export function atItems({ bots, files, conversations, query }) {
  const q = query ?? '';
  const fileGroup = () => ({ label: t('composer.menu.files'), items: (files ?? []).map(fileItem) });
  if (q.includes('/')) {
    const g = fileGroup();
    return g.items.length ? [{ ...g, crumb: q.slice(0, q.lastIndexOf('/') + 1) }] : [];
  }
  const groups = [];
  if (bots?.length) {
    const items = bots.map(b => ({ kind: 'bot', id: b.id, name: b.name, description: b.description ?? '' }));
    groups.push({ label: t('composer.menu.bots'), items: rankByLetters(items, q, b => `${b.name} ${b.id}`) });
  }
  groups.push(fileGroup());
  groups.push({
    label: t('composer.menu.conversations'),
    items: rankByLetters(conversations ?? [], q, c => c.title).slice(0, CONVERSATION_ITEMS),
  });
  return groups.filter(g => g.items.length);
}

export function conversationChoices(conversations, { exceptId, workspaceId, now }) {
  const live = (conversations ?? []).filter(c => !c.archived && c.id !== exceptId);
  const newest = (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const own = live.filter(c => c.workspaceId === workspaceId).sort(newest);
  const other = live.filter(c => c.workspaceId !== workspaceId).sort(newest);
  return [...own, ...other].map(c => ({ kind: 'conversation', id: c.id, title: c.title, age: ago(c.updatedAt ?? 0, now) }));
}

export const flatItems = menu => menu.groups.flatMap(g => g.items);

export function moveActive(menu, delta) {
  const n = flatItems(menu).length;
  if (!n) return { ...menu, active: 0 };
  return { ...menu, active: (((menu.active + delta) % n) + n) % n };
}

export function chipOf(item) {
  if (item.kind === 'bot') return { kind: 'bot', id: item.id, label: item.name };
  if (item.kind === 'file') return { kind: 'file', path: item.path, dir: item.dir, label: item.dir ? item.name + '/' : item.name };
  return { kind: 'conversation', id: item.id, label: item.title };
}
