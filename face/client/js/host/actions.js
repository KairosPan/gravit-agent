// face/client/js/host/actions.js — a data-action becomes the Remote the old client sent (spec 2026-10-19 §5, §7 "Composer").
// Every wire shape here is chat.js's as it stood on main: session/prompt in queue mode with a client-minted requestId
// and the browser's zone; a slash line to commands/execute first; an @ inside a channel to /data/rooms/say first.
import { randomUuid } from '../wire/api.js';
import { isMentionText } from '../wire/room.js';
import { needsAnswer } from '../messages.js';

export const NOT_SIGNED_IN = 'Not signed in — open the URL gravit-face printed';

const zone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};
const clean = text => (typeof text === 'string' ? text.trim() : '');

// activate(sessionId) → Promise<boolean>: the conversation made live before a command runs on it (live.activate)
export function makeActions({ store, call, answerGate, postJson, requestId = randomUuid, timeZone = zone, activate = async () => true }) {
  const say = (line, bad = false) => store.dispatch('hostStatus', { line, bad });
  const fail = (err, what) => say(err?.status === 401 ? NOT_SIGNED_IN : `${what}: ${err?.code ?? (err?.status ? `HTTP ${err.status}` : err?.message ?? 'failed')}`, true);
  // the content: the text part when the words are not blank, then the attachments (already parts: an image inline, a file
  // by its receipt) in the draft's order
  const prompt = (sessionId, text, attachments = []) => call('session/prompt', {
    request: { requestId: requestId(), sessionId, mode: 'queue', content: [...(clean(text) ? [{ type: 'text', text }] : []), ...attachments], clientTimeZone: timeZone() },
  });
  const ATTACHMENT_INVALID = 'session/attachment-invalid';
  // at rc.5 commands/execute settles an admission failure as an error result, never a throw; a receipt the host dropped
  // reads as AttachmentError ATTACHMENT_NOT_FOUND's message (dsh-commands), the reason code itself not carried
  const RECEIPT_UNKNOWN = 'File upload receipt is unknown for this session.';
  // a refusal of the attachments (a receipt the host dropped, an image on a text-only model): the caller's to answer, else
  // said with its reason; any other failure as `what`'s
  const failSend = (err, what, attachmentRefused) => {
    if (err?.code !== ATTACHMENT_INVALID) { fail(err, what); return; }
    const reason = err.details?.reason;
    if (attachmentRefused) attachmentRefused(reason);
    else say(`${what}: ${ATTACHMENT_INVALID}${reason ? ` (${reason})` : ''}`, true);
  };

  // a slash line, on a conversation made live first (at dsh 0.2.1-rc.5 commands/execute resumes a cold agent itself; the
  // follow keeps the page in step so the result draws); `undefined` back means no command claimed it and the line is a
  // prompt after all
  async function command(sessionId, line, attachments = []) {
    if (!(await activate(sessionId))) throw new Error('the conversation did not open');
    const executed = await call('commands/execute', { agentId: sessionId, line, submittedAttachments: attachments });
    if (executed === undefined || executed === null) return null;
    const result = executed.result;
    say(typeof result?.text === 'string' && result.text !== '' ? result.text : String(result?.kind ?? 'done'), result?.kind === 'error');
    return executed;
  }

  // a command chosen from the composer's menu: its result on the status line, or its failure
  async function runCommand(sessionId, line) {
    try {
      if ((await command(sessionId, line)) === null) say(`no command claimed ${line}`);
      return true;
    } catch (err) {
      fail(err, 'command');
      return false;
    }
  }

  // room: whether a channel conversation's words go to its room first (the composer decides by its chips; a bare call by
  // an @ in the words, as before). attachments (content parts) go to Gravit: the room, which carries text only, is never
  // tried with them. attachmentRefused(reason) answers a refusal of the attachments in place of the status line
  async function send(text, { room, attachments = [], attachmentRefused } = {}) {
    const words = clean(text);
    if (!words && !attachments.length) return null;
    const s = store.get();
    const id = s.route.screen === 'messages' ? s.route.id : null;
    const conv = s.conversations.find(c => c.id === id);
    if (!conv) return null;
    try {
      if (words.startsWith('/')) {
        const executed = await command(id, words, attachments);
        // with files an error result is a refusal of them, its text already said: the draft is kept; a dropped receipt
        // is the caller's to stage again
        if (executed !== null && attachments.length && executed.result?.kind === 'error') {
          if (executed.result.text === RECEIPT_UNKNOWN) attachmentRefused?.('ATTACHMENT_NOT_FOUND');
          return null;
        }
        if (executed !== null) return { sent: 'command', sessionId: id };
      }
      if (!attachments.length && conv.channel && (room ?? isMentionText(words))) {
        const answer = await postJson('/data/rooms/say', { sessionId: id, text: words });
        if (Array.isArray(answer?.addressed) && answer.addressed.length > 0) return { sent: 'say', sessionId: id };
      }
      await prompt(id, words, attachments);
      return { sent: 'prompt', sessionId: id };
    } catch (err) {
      failSend(err, 'send', attachmentRefused);
      return null;
    }
  }

  // create (in a channel, or the host's default directory), name it when a title was typed, tell the caller its id, let
  // it prepare the files there (their parts, or null when they did not go up), then the first words and the parts. A
  // failure after the create still answers the id, with sent false, so the caller can open what was made
  async function newConversationWith({ title, workspaceId, text, onCreated, prepare, attachmentRefused }) {
    let sessionId = null;
    try {
      const created = await call('session/create', { request: workspaceId ? { workspaceId } : {} });
      if (typeof created?.sessionId !== 'string') throw new Error('session/create returned no sessionId');
      sessionId = created.sessionId;
      onCreated?.(sessionId);   // before the rename: a failure from here on still leaves the draft with the conversation
      const name = clean(title);
      if (name) await call('session/rename', { request: { sessionId, title: name } });
      const parts = prepare ? await prepare(sessionId) : [];
      if (parts === null) return { id: sessionId, sent: false };
      const words = clean(text);
      if (words || parts.length) await prompt(sessionId, words, parts);
      return { id: sessionId, sent: true };
    } catch (err) {
      failSend(err, 'new message', attachmentRefused);
      return { id: sessionId, sent: false };
    }
  }
  // the words alone (the Run sheet): the id when they went, else null
  async function newConversation({ title, workspaceId, text }) {
    const { id, sent } = await newConversationWith({ title, workspaceId, text });
    return sent ? id : null;
  }

  // the mux's answer under the current generation; the card takes this tab's outcome at once. One answer per gate is
  // in flight at a time: a second press (a double-click on ✓) sends nothing, where it would earn api.js's gate-gone
  // refusal in red over an approval that stood
  const answering = new Set();
  async function answer(eventId, value) {
    if (answering.has(eventId)) return false;
    answering.add(eventId);
    try {
      await answerGate(eventId, value);
      store.dispatch('hostGateGone', { eventId, outcome: value === 'allowed-once' ? 'approved' : value === 'rejected' ? 'rejected' : 'answered' });
      return true;
    } catch (err) {
      say(`answer: ${err?.code ?? err?.message ?? 'failed'}`, true);
      return false;
    } finally {
      answering.delete(eventId);
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

  // the row actions (spec §7 Stage 3 "Row actions"): fork, archive / un-archive, delete. One fork per source in flight;
  // archiving waits for a running turn or a waiting card to end, deleting for a running turn
  const convOf = id => store.get().conversations.find(c => c.id === id);
  const forking = new Set();
  async function fork(sessionId) {
    if (forking.has(sessionId)) return null;
    forking.add(sessionId);
    try {
      const forked = await call('session/fork', { request: { sessionId } });
      if (typeof forked?.sessionId !== 'string') throw new Error('session/fork returned no sessionId');
      return forked.sessionId;
    } catch (err) {
      fail(err, 'fork');
      return null;
    } finally {
      forking.delete(sessionId);
    }
  }

  // pin / unpin: the answer is the whole set; a throw leaves the set as it was
  async function setPin(remote, sessionId) {
    try {
      const answer = await call(remote, { request: { sessionId } });
      if (!Array.isArray(answer?.pinnedSessionIds)) throw new Error(`${remote} returned no pinnedSessionIds`);
      store.dispatch('hostPins', answer.pinnedSessionIds);
      return true;
    } catch {
      say('Pin failed. Try again later.', true);
      return false;
    }
  }
  const pin = sessionId => setPin('workspace/pinSession', sessionId);
  const unpin = sessionId => setPin('workspace/unpinSession', sessionId);

  async function archive(sessionId, archived) {
    const c = convOf(sessionId);
    if (archived && c?.running) { say('Stop Gravit first', true); return false; }
    if (archived && c?.messages.some(needsAnswer)) { say('Answer the waiting card first', true); return false; }
    try {
      await postJson('/data/sessions/archive', { sessionId, archived: archived === true });
      if (archived === true && store.get().pinned?.includes(sessionId)) await unpin(sessionId); // an archived row is never pinned (D7)
      return true;
    } catch (err) {
      fail(err, archived ? 'archive' : 'un-archive');
      return false;
    }
  }

  async function remove(sessionId) {
    if (convOf(sessionId)?.running) { say('Stop Gravit first', true); return false; }
    try {
      await postJson('/data/sessions/delete', { sessionId });
      return true;
    } catch (err) {
      fail(err, 'delete');
      return false;
    }
  }

  // Talk to <bot>: its newest home conversation that is not archived, else a new one in the bot's home with its preset
  async function talkTo(bot) {
    const home = store.get().conversations.filter(c => c.kind === 'bot' && c.preset === bot?.id && !c.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (home) return { id: home.id };
    try {
      const created = await call('session/create', { request: { cwd: bot.homeCwd, agentPreset: bot.id } });
      if (typeof created?.sessionId !== 'string') throw new Error('session/create returned no sessionId');
      return { id: created.sessionId };
    } catch (err) {
      return { error: `talk to: ${err?.code ?? err?.message ?? 'failed'}` };
    }
  }

  // a running continuable child, stopped by its parent: its current turn is interrupted (a one-shot child is never sent)
  async function stopChild(parentSessionId, childSessionId, label) {
    try {
      const r = await call('subagents/interruptByParent', { childSessionId, parentSessionId, mode: 'continuable' });
      if (r?.accepted === false) throw new Error('refused');
      say(`Stopping ${label || 'the child'}`);
      return true;
    } catch (err) {
      fail(err, 'stop');
      return false;
    }
  }

  return { send, newConversation, newConversationWith, answer, stop, rename, command, runCommand, fork, archive, pin, unpin, remove, talkTo, stopChild };
}
