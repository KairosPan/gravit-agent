// face/client/js/render/memory-page.js — the Memory screen (#/memory/<tab>, memory screen plan Task 2): the head, the four
// tabs as links - Lessons, Decisions, Waiting with the count of the proposals waiting, Health - and the open tab's read:
// Loading… before it answers; a memory not connected, its words as the face gave them and the command that makes the home,
// and no tab body; a failed read, one line with its words above what it kept, or Unavailable with nothing kept; else the
// tab's body (render/memory-lessons.js, memory-decisions.js, memory-waiting.js, memory-health.js). Every text from the memory is
// made visible (visible.js) and then escaped.
import { esc } from '../html.js';
import { t, th, sayOf } from '../i18n/words.js';
import { visible } from '../visible.js';
import { MEMORY_TABS } from '../router.js';
import { segLinks } from './controls.js';
import { lessonsHtml } from './memory-lessons.js';
import { decisionsHtml } from './memory-decisions.js';
import { waitingHtml } from './memory-waiting.js';
import { healthHtml } from './memory-health.js';

const dim = text => `<p class="mp-dim">${esc(text)}</p>`;

const tabWord = tab => {
  switch (tab) {
    case 'decisions': return t('memory.page.decisions');
    case 'waiting': return t('memory.page.waiting');
    case 'health': return t('memory.page.health');
    default: return t('memory.page.lessons');
  }
};

// the proposals the waiting read holds, none until it has answered connected
function waitingCount(page) {
  const w = page.waiting?.data;
  return w?.connected === true && Array.isArray(w.proposals) ? w.proposals.length : 0;
}

function tabs(page, open) {
  const n = waitingCount(page);
  return `<div class="mp-tabs">${segLinks(MEMORY_TABS.map(id => [id === 'waiting' && n ? t('memory.page.waitingCount', { n }) : tabWord(id), `#/memory/${id}`, id]), open)}</div>`;
}

const notConnected = data => `<p class="mp-say">${esc(visible(data.say))}</p><code class="mp-command">${esc(visible(data.command))}</code>`;

// a tab's body, each in an mp-body, each drawn by its own renderer
const BODIES = { lessons: lessonsHtml, decisions: decisionsHtml, waiting: waitingHtml, health: healthHtml };
const tabBody = (tab, data, page, now) => (Object.hasOwn(BODIES, tab) ? BODIES[tab] : lessonsHtml)(data, page, now);

function body(read, tab, page, now) {
  const failed = read.status === 'error' || read.message != null;
  const line = read.message != null ? dim(visible(sayOf(read.message))) : '';
  if (read.data == null) return failed ? `${line}${dim(t('memory.page.unavailable'))}` : dim(t('common.loading'));
  if (read.data.connected === false) return `${line}${notConnected(read.data)}`;
  return `${line}${tabBody(tab, read.data, page, now)}`;
}

export function renderMemoryScreen(state, now) {
  const page = state.memoryPage;
  const tab = MEMORY_TABS.includes(state.route.tab) ? state.route.tab : MEMORY_TABS[0];
  return `<main class="main mp"><header class="head"><h1 class="head-title">${th('memory.page.title')}</h1></header>${tabs(page, tab)}` +
    `<div class="mp-page">${body(page[tab], tab, page, now)}</div></main>`;
}
