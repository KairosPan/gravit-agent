// face/client/js/host/actions.js — a data-action becomes the Remote the old client sent (spec 2026-10-19 §5, §7 "Composer").
// Every wire shape here is chat.js's as it stood on main: session/prompt in queue mode with a client-minted requestId
// and the browser's zone; a slash line to commands/execute first; an @ inside a channel to /data/rooms/say first.
import { randomUuid } from '../wire/api.js';
import { isMentionText } from '../wire/room.js';

export const NOT_SIGNED_IN = 'Not signed in — open the URL gravit-face printed';

const zone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};
const clean = text => (typeof text === 'string' ? text.trim() : '');

export function makeActions({ store, call, answerGate, postJson, requestId = randomUuid, timeZone = zone }) {
  const say = (line, bad = false) => store.dispatch('hostStatus', { line, bad });
  const fail = (err, what) => say(err?.status === 401 ? NOT_SIGNED_IN : `${what}: ${err?.code ?? (err?.status ? `HTTP ${err.status}` : err?.message ?? 'failed')}`, true);
  const prompt = (sessionId, text) => call('session/prompt', {
    request: { requestId: requestId(), sessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: timeZone() },
  });

  // a slash line; `undefined` back means no command claimed it and the line is a prompt after all
  async function command(sessionId, line) {
    const executed = await call('commands/execute', { agentId: sessionId, line, submittedAttachments: [] });
    if (executed === undefined || executed === null) return null;
    const result = executed.result;
    say(typeof result?.text === 'string' && result.text !== '' ? result.text : String(result?.kind ?? 'done'), result?.kind === 'error');
    return executed;
  }

  async function send(text) {
    const words = clean(text);
    if (!words) return null;
    const s = store.get();
    const id = s.route.screen === 'messages' ? s.route.id : null;
    const conv = s.conversations.find(c => c.id === id);
    if (!conv) return null;
    try {
      if (words.startsWith('/') && (await command(id, words)) !== null) return { sent: 'command', sessionId: id };
      if (conv.channel && isMentionText(words)) {
        const answer = await postJson('/data/rooms/say', { sessionId: id, text: words });
        if (Array.isArray(answer?.addressed) && answer.addressed.length > 0) return { sent: 'say', sessionId: id };
      }
      await prompt(id, words);
      return { sent: 'prompt', sessionId: id };
    } catch (err) {
      fail(err, 'send');
      return null;
    }
  }

  // create (in a channel, or the host's default directory), name it when a title was typed, then the first words
  async function newConversation({ title, workspaceId, text }) {
    try {
      const created = await call('session/create', { request: workspaceId ? { workspaceId } : {} });
      const sessionId = created?.sessionId;
      if (typeof sessionId !== 'string') throw new Error('session/create returned no sessionId');
      const name = clean(title);
      if (name) await call('session/rename', { request: { sessionId, title: name } });
      const words = clean(text);
      if (words) await prompt(sessionId, words);
      return sessionId;
    } catch (err) {
      fail(err, 'new message');
      return null;
    }
  }

  // the mux's answer under the current generation; the card takes this tab's outcome at once
  async function answer(eventId, value) {
    try {
      await answerGate(eventId, value);
      store.dispatch('hostGateGone', { eventId, outcome: value === 'allowed-once' ? 'approved' : value === 'rejected' ? 'rejected' : 'answered' });
      return true;
    } catch (err) {
      say(`answer: ${err?.code ?? err?.message ?? 'failed'}`, true);
      return false;
    }
  }

  async function stop(sessionId) {
    try {
      await call('session/cancel', { request: { sessionId } });
      say('Stopped. A paused goal resumes with /goal resume');
    } catch (err) {
      fail(err, 'stop');
    }
  }

  async function rename(sessionId, title) {
    const name = clean(title);
    if (!name) return;
    try {
      await call('session/rename', { request: { sessionId, title: name } });
    } catch (err) {
      fail(err, 'rename');
    }
  }

  return { send, newConversation, answer, stop, rename, command };
}
