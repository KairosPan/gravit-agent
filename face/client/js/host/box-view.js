// face/client/js/host/box-view.js — the Gravit box's facts beyond where it stands (host/sessions.js boxShown): what covers it,
// what it steps aside for, and the ball's marks. Pure.
import { waitingCount } from './rail-view.js';
import { unreadOf } from './sessions.js';
import { toHash } from '../router.js';

/** The page chip is on: × did not take this page off (reducers/box.js boxDetach); any other page brings it back. */
export const boxAttached = state => state.boxDetached !== toHash(state.route);

/** An owner sheet (Trade's order step included) or the identity connect sheet is over the page: the box stays under it. */
export const boxCovered = state => Boolean(state.sheet) || Boolean(state.identity?.connect);

/** What the box steps aside for: a drawer open on the right, else Trade's open ticket; null when nothing. */
export function boxAside(state) {
  if (state.sellMany || state.runSheet || state.lunhui?.stock || state.detailsOpen || state.settingsOpen
    || state.account?.statementOpen || state.account?.detailsVenue) return 'drawer';
  if (state.route.screen === 'trade' && state.trade?.ticket) return 'ticket';
  return null;
}

/** The ball's marks: the tasks waiting on the operator, the conversation working, and a reply not yet seen while it rests. */
export function ballMarks(state) {
  const record = (state.conversations ?? []).find(c => c.id === state.tasks?.conversation);
  const working = record?.running === true;
  return { waiting: waitingCount(state), working, fresh: !!record && unreadOf(record) && !working };
}
