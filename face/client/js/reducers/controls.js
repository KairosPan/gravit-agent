// face/client/js/reducers/controls.js — the in-page controls: inline editors and two-step confirms (they replaced prompt and confirm),
// and the Account panels the later stages still draw.
import { money } from '../html.js';
import { reducers as messages, closeOverlays } from './messages.js';
import { STANDIN_CASH, instrument, VENUES, CONNECTABLE } from '../data/markets.js';
import { revalue, markOf, legsOf } from '../trade.js';
import { reducers as account } from './account.js';

const num = v => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) && n > 0 ? n : null; };
const fail = (s, error) => ({ ...s, edit: { ...s.edit, error } });
const done = s => ({ ...s, edit: null });

export const reducers = {
  startEdit: (s, spec) => ({ ...s, edit: spec, confirm: null }),
  cancelEdit: s => (s.edit ? { ...s, edit: null } : s),

  // one commit for every editor: it reads the values the editor's inputs held and checks them
  commitEdit(s, { values = {} }) {
    const e = s.edit;
    if (!e) return s;
    switch (e.kind) {
      case 'rename': {
        const t = String(values.title ?? '').trim();
        return t ? done(messages.rename(s, { convId: e.convId, title: t })) : fail(s, 'Cannot be empty');
      }
      case 'memory': {
        const t = String(values.text ?? '').trim();
        return t ? done(account.editMemory(s, { id: e.id, text: t })) : fail(s, 'Cannot be empty');
      }
      default:
        return done(s);
    }
  },

  // Account's panels (Move, Receive, Statement, Connect): drawers, one at a time
  openPanel: (s, panel) => { const c = closeOverlays(s); return { ...c, account: { ...c.account, panel, panelError: null, copied: false } }; },
  closePanel: s => (s.account.panel ? { ...s, account: { ...s.account, panel: null, panelError: null } } : s),
  // Move: an asset from one venue to another; what you own stays the same
  moveFunds(s, { from, to, asset, amount, now }) {
    const n = num(amount);
    const err = panelError => ({ ...s, account: { ...s.account, panelError } });
    if (!n) return err('Needs a number above 0');
    if (from === to) return err('Pick a different destination');
    const src = s.account.holdings.find(h => h.name === asset && h.venue === from);
    if (!src) return err(`${from} has no ${asset}`);
    if (n > src.value) return err(`${from} only has ${money(src.value)}`);
    // dollars move as quantity at the holding's price; revalue then prints the values
    // all of it (to the cent shown) moves the whole quantity, so nothing below zero is left behind
    const whole = n >= src.value - 0.005;
    const dq = whole ? src.qty ?? src.value : n / (markOf(src) ?? 1);
    const tidy = v => Number(v.toFixed(8));
    let holdings = whole ? s.account.holdings.filter(h => h !== src) : s.account.holdings.map(h => (h === src ? { ...h, qty: tidy((h.qty ?? h.value) - dq) } : h));
    const dst = holdings.find(h => h.name === asset && h.venue === to);
    holdings = dst ? holdings.map(h => (h === dst ? { ...h, qty: tidy((h.qty ?? h.value) + dq) } : h)) : [...holdings, { ...src, key: `${src.key}@${to}`, venue: to, qty: tidy(dq) }];
    const activity = [{ at: now, text: `Move ${money(n)} ${asset} · ${from} → ${to}`, amount: 0 }, ...s.account.activity];
    return { ...s, account: revalue({ ...s.account, holdings, activity, panel: null, panelError: null }) };
  },
  // Connect an account: a stand-in venue answers a moment later (app.js schedules venueConnected)
  connectVenue: (s, name) => (CONNECTABLE.includes(name) && !s.account.venues.some(v => v.name === name) ? { ...s, account: { ...s.account, connecting: name } } : s),
  // a stand-in account arrives with its own dollars; a ticket waiting on this venue takes it
  venueConnected(s, name) {
    if (s.account.venues.some(v => v.name === name)) return s;
    const cash = STANDIN_CASH[name] ? { ...s.account.cash, [name]: (s.account.cash?.[name] ?? 0) + STANDIN_CASH[name] } : s.account.cash;
    const account = revalue({ ...s.account, connecting: null, cash, venues: [...s.account.venues, { name, line: 'Connected · stand-in · Gravit: read only', state: 'Healthy' }] });
    const t = s.trade?.ticket;
    const waits = t?.id && !t.venue && legsOf(instrument(t.id), account, t.outcome).some(l => l.state === 'able' && l.venue === name);
    return { ...s, account, trade: waits ? { ...s.trade, ticket: { ...t, venue: name } } : s.trade };
  },
  setCopied: (s, on) => (s.account.copied === !!on ? s : { ...s, account: { ...s.account, copied: !!on } }),

  askConfirm: (s, spec) => ({ ...s, confirm: spec, edit: null }),
  cancelConfirm: s => (s.confirm ? { ...s, confirm: null } : s),
};

