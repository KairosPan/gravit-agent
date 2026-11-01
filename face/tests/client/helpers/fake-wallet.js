// a fake EIP-1193 provider, the browser wallet as the face's wallet module speaks to it: every request recorded, each method
// answered as told (a value, or a function of the params that may throw); and a fake window that announces wallets (EIP-6963).
// Nothing here is a real wallet, and nothing reaches a network.

export const ADDRESS = '0x' + '12'.repeat(20);
export const hashOf = n => '0x' + String(n).padStart(64, 'a');

export function fakeProvider({ accounts = [ADDRESS], chainId = '0x2105', answers = {}, flags = {} } = {}) {
  let sent = 0;
  const requests = [];
  const defaults = {
    eth_requestAccounts: () => accounts,
    eth_accounts: () => accounts,
    eth_chainId: () => chainId,
    personal_sign: () => '0x' + 'ee'.repeat(65),
    wallet_switchEthereumChain: () => null,
    wallet_addEthereumChain: () => null,
    eth_sendTransaction: () => hashOf(++sent),
    eth_getTransactionReceipt: () => ({ blockNumber: '0x10', status: '0x1' }),
  };
  const provider = {
    ...flags,
    requests,
    async request({ method, params }) {
      requests.push({ method, params });
      const a = Object.hasOwn(answers, method) ? answers[method] : defaults[method];
      if (a === undefined) throw Object.assign(new Error(`${method} is not supported`), { code: 4200 });
      return typeof a === 'function' ? a(params, requests) : a;
    },
    methods: () => requests.map(r => r.method),
    count: method => requests.filter(r => r.method === method).length,
  };
  return provider;
}

// a window whose wallets answer a requestProvider by announcing themselves (each `times` times); `ethereum` its injected one
export function fakeWin({ announce = [], times = 1, ethereum } = {}) {
  const listeners = {};
  const win = {
    Event: class { constructor(type) { this.type = type; } },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter(f => f !== fn); },
    dispatchEvent(ev) {
      if (ev.type !== 'eip6963:requestProvider') return true;
      for (let i = 0; i < times; i++) for (const detail of announce) for (const fn of listeners['eip6963:announceProvider'] ?? []) fn({ detail });
      return true;
    },
    listeners,
  };
  if (ethereum) win.ethereum = ethereum;
  return win;
}

// a schedule that runs at once (a receipt's 2 s wait, in a test)
export const now = fn => { queueMicrotask(fn); return 0; };
