// face/tests/client/helpers/inventory.js — the face's four listings as Discover reads them (/data/plugins.json,
// /data/bots.json, /data/agents.json, /data/memory.json), each as a loaded shelf.
const shelf = data => ({ status: 'ready', data, at: 1 });

export const buffett = {
  id: 'buffett', name: 'Buffett Type', description: 'Buys cheap, holds long', dir: '/r/bots/buffett', homeCwd: '/r/bots/buffett/home',
  soul: '# Buffett\nBuy cheap.', revision: 'r1', allow: [], compositionSoul: null, soulInSync: true,
  skills: [{ name: 'value', description: 'Value screens', path: '/r/bots/buffett/skills/value' }], setupIssues: ['skills/notes missing'],
  model: 'deepseek/deepseek-chat', isDefault: false, listed: true,
};

export const listings = () => ({
  plugins: shelf({ ok: true, mcp: [
    { server: 'alpaca-kit', phase: 'active', tools: [{ name: 'mcp__alpaca-kit__account', description: 'The paper account' }, { name: 'mcp__alpaca-kit__screen', description: 'Screen' }] },
    { server: 'akshare', phase: 'failed', tools: [] },
  ], agentTools: [], rows: [] }),
  bots: shelf({ ok: true, bots: [
    { id: 'gravit', name: 'Gravit', description: 'host', isDefault: true, listed: true },
    buffett,
  ] }),
  agents: shelf({ ok: true, main: { name: 'Gravit', runtime: 'dsh 0.2.0-rc.2' },
    local: [{ bin: 'codex', label: 'Codex', found: true, version: '0.9', auth: { state: 'ok', account: 'pan' }, tool: 'agent_codex' }, { bin: 'gone', label: 'Gone', found: false, auth: { state: 'unknown' } }],
    candidates: [{ bin: 'claude', label: 'Claude Code', version: '2.1' }] }),
  memory: shelf({ ok: true, groups: [
    { name: 'mechanics', skills: [{ name: 'rules', description: 'The five honest-eval rules' }] },
    { name: 'style-gravit', skills: [{ name: 'voice', description: 'How Gravit writes' }] },
  ] }),
});
