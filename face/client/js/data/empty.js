// face/client/js/data/empty.js — the state the client boots into before the host answers: no conversations, a status line.
// Every slice a later stage's screen reads keeps its empty shape, so their render code still boots.
export function emptyState() {
  return {
    theme: 'system',
    route: { screen: 'messages', id: null },
    lastConv: null,
    railCollapsed: false,
    draft: null,
    detailsOpen: false,
    settingsOpen: false,
    conversations: [],
    channels: [],
    status: { line: 'connecting…', bad: false, connected: false },
    orphanGates: {},
    lastSeen: {},
    discover: { query: '', installedOnly: false, create: null, toast: null },
    markets: { tab: 'all', sort: 'volume', q: '', interval: '1h', watch: [] },
    trade: { kind: 'crypto', q: '', ticket: null },
    plugins: { installed: [], mine: [], uploaded: [] },
    memory: { entries: [], remember: true, askFirst: false, botsRead: false },
    account: {
      mode: 'guard', netWorth: 0, today: 0, todayPct: 0, alloc: [], holdings: [], cash: {}, orders: [], venues: [],
      wallet: null, receive: null, activity: [], panel: null, connecting: null, copied: false, panelError: null,
    },
    banner: null,
    call: null,
    edit: null,
    confirm: null,
    compose: { files: [], listening: false },
    mail: { address: '', items: [] },
  };
}
