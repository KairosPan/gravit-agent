// face/client/js/reducers/account.js — Account on the face: what host/account.js brings in, the Statement drawer, the
// Settings drawer; and Memory, which Discover's Like shelf still reads until stage 3
import { closeOverlays } from './messages.js';
import { nextId } from '../ids.js';

const mem = (s, patch) => ({ ...s, memory: { ...s.memory, ...patch } });
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
  addMemory(s, { text, now }) {
    const t = (text ?? '').trim();
    if (!t) return s;
    const { id, counters } = nextId(s.counters, 'mem');
    return { ...mem(s, { entries: [...s.memory.entries, { id, group: 'Added by you', text: t, source: 'You said', at: now }] }), counters };
  },
  editMemory: (s, { id, text }) => mem(s, { entries: s.memory.entries.map(e => (e.id === id ? { ...e, text: (text ?? '').trim() || e.text } : e)) }),
  forgetMemory: (s, id) => mem(s, { entries: s.memory.entries.filter(e => e.id !== id) }),
  forgetAll: s => mem(s, { entries: [] }),
  setMemorySwitch: (s, { key, value }) => (['remember', 'askFirst', 'botsRead'].includes(key) ? mem(s, { [key]: !!value }) : s),
};
