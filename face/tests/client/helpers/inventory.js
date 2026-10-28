// face/tests/client/helpers/inventory.js — the face's listings as Discover reads them (/data/plugins.json,
// /data/bots.json, /data/agents.json, /data/memory.json), each as a loaded shelf, and /data/modules.json.
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

// /data/modules.json as plan 1 answers it: cn-market's one sealed run (environment, sentiment, a not-evaluable
// theme, four counterevidence items), lunhui-s01-repair's newer run (no leader candidate, WAIT, five items) citing
// it, and lunhui-s02-rotation with no run yet.
export const MARKET_RUN = '20261028T020953Z-f3b89ce6';
export const S01_RUN = '20261028T021514Z-ecbf72e6';
const ok = (headline, marketRun = null) => ({ status: 'OK', missingSources: [], headline, marketRun });
export function modulesListing() {
  const cnMarket = {
    channel: 'cn-market', workspaceId: 'ws-cn-market', kind: 'market', runsOmitted: 0,
    runs: [{
      run: MARKET_RUN, session: '2026-10-28', asOf: '2026-10-28T02:09:59.229Z',
      openedAt: '2026-10-28T02:09:53.000Z', sealedAt: '2026-10-28T02:10:02.000Z', frozen: ['index', 'limit-up'],
      artifacts: {
        environment: ok({ index_state: 'WEAK', liquidity_state: 'STABLE', cycle_anchor: '低位反抽' }),
        sentiment: ok({ state: 'IGNITION', money_effect: 'POSITIVE', freeze_type: 'NONE' }),
        theme: { status: 'NOT_EVALUABLE', missingSources: ['boards'], headline: { mainline_candidates: [], theme_stage: 'UNKNOWN', rotation: 'UNKNOWN' }, marketRun: null },
        counterevidence: ok({ items: [{}, {}, {}, {}] }),
      },
    }],
  };
  const s01 = {
    channel: 'lunhui-s01-repair', workspaceId: 'ws-lunhui-s01-repair', kind: 'strategy', runsOmitted: 0,
    runs: [{
      run: S01_RUN, session: '2026-10-28', asOf: '2026-10-28T02:15:20.000Z',
      openedAt: '2026-10-28T02:15:14.000Z', sealedAt: '2026-10-28T02:15:22.000Z', frozen: ['quotes'],
      artifacts: {
        leader: ok({ leader_candidates: [], top_pattern_flags: [] }, MARKET_RUN),
        mode: ok({ mode: 'WAIT', preconditions: [], research_only_matches: [], expectation: null, expectation_review: null }, MARKET_RUN),
        counterevidence: ok({ items: [{}, {}, {}, {}, {}] }, MARKET_RUN),
      },
    }],
  };
  const s02 = { channel: 'lunhui-s02-rotation', workspaceId: 'ws-lunhui-s02-rotation', kind: 'strategy', runs: [], runsOmitted: 0 };
  return { ok: true, mounted: true, root: '/r', channels: [cnMarket, s01, s02] };
}
