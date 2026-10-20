// face/client/js/reducers/account.js — Account on the face: what host/account.js brings in, the Statement drawer, the
// Settings drawer
import { closeOverlays } from './messages.js';

const acc = (s, patch) => ({ ...s, account: { ...s.account, ...patch } });

export const reducers = {
  // the host's account (host/account.js): /data/account.json as read, the keys, the registry's tool names, the quote providers
  accountLoading: s => acc(s, { status: 'loading' }),
  accountLoaded: (s, { data, at }) => acc(s, { status: 'ready', data, at }),
  // a failed read keeps the last data: the screen says it is not current rather than going blank
  accountFailed: (s, { at }) => acc(s, { status: 'error', at }),
  credentialsLoaded: (s, creds) => acc(s, { creds }),
  toolsLoaded: (s, names) => acc(s, { tools: names }),
  probeLoaded: (s, providers) => acc(s, { probe: providers }),
  // the Statement is a drawer: one at a time, as Settings and Details are
  openStatement: s => { const c = closeOverlays(s); return { ...c, account: { ...c.account, statementOpen: true } }; },
  closeStatement: s => (s.account.statementOpen ? acc(s, { statementOpen: false }) : s),

  openSettings: s => ({ ...closeOverlays(s), settingsOpen: true }),
  closeSettings: s => ({ ...s, settingsOpen: false, edit: null, confirm: null }),
};
