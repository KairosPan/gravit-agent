// face/client/js/host/composer.js — the composer menus' reads: the / menu's commands (commands/list on a live
// conversation, kept by agent preset so a cold one shows the last rows read for its preset, D13 — reading never
// activates) and skills (skills/list, which reads a cold session as it is); the @ menu's files (GET /data/files, only the
// latest call answers) and a room's roster (POST /data/rooms/state). Impure; nothing here draws or dispatches.
export const presetKey = conv => conv?.preset ?? 'gravit';

export function startComposerReads({ call, getJson, postJson }) {
  const commandsByPreset = new Map();
  const skillsBySession = new Map();
  const rosterBySession = new Map();
  let filesSeq = 0;

  return {
    keptCommands(conv) {
      return commandsByPreset.get(presetKey(conv)) ?? null;
    },
    async commands(conv) {
      const key = presetKey(conv);
      if (conv?.live === true && typeof conv.id === 'string') {
        try {
          const rows = await call('commands/list', { agentId: conv.id });
          if (Array.isArray(rows)) commandsByPreset.set(key, rows);
        } catch { /* a cold or gone agent: the kept rows stand */ }
      }
      return commandsByPreset.get(key) ?? null;
    },
    keptSkills(sessionId) {
      return skillsBySession.get(sessionId) ?? null;
    },
    async skills(sessionId) {
      let rows = [];
      try {
        const answer = await call('skills/list', { request: { sessionId } });
        if (Array.isArray(answer?.skills)) rows = answer.skills;
      } catch { /* none */ }
      skillsBySession.set(sessionId, rows);
      return rows;
    },
    async files(q, dir) {
      const token = ++filesSeq;
      const query = typeof q === 'string' ? q : '';
      const path = `/data/files?q=${encodeURIComponent(query)}${typeof dir === 'string' && dir !== '' ? `&dir=${encodeURIComponent(dir)}` : ''}`;
      let answer;
      try { answer = await getJson(path); } catch { return null; }
      if (token !== filesSeq) return null;
      if (answer?.ok !== true || !Array.isArray(answer.items)) return null;
      return { items: answer.items, truncated: answer.truncated === true };
    },
    async roster(sessionId) {
      let rows = [];
      try {
        const answer = await postJson('/data/rooms/state', { sessionId });
        if (Array.isArray(answer?.roster)) rows = answer.roster;
      } catch { /* not a room, or the route refused: none */ }
      rosterBySession.set(sessionId, rows);
      return rows;
    },
  };
}
