// face/client/js/render/desk-page.js — the Desk page (#/desk, desk-page plan 1): its title alone until Task 4 draws its News
// and its Routines on the deskPage slice and the desk's status.
import { esc } from '../html.js';
import { t } from '../i18n/words.js';

export function renderDeskScreen(state, now) {
  return `<main class="main dk"><header class="head"><h1 class="head-title">${esc(t('desk.page.title'))}</h1></header></main>`;
}
