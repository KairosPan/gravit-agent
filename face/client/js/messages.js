// face/client/js/messages.js — the message model: colour is importance (front-end spec §6), over the host's kinds alone
export const LEVELS = { text: 'grey', tool: 'grey', card: 'orange', approval: 'orange', question: 'orange', refusal: 'red', receipt: 'green' };

export const levelOf = m => LEVELS[m.kind] ?? 'grey';

// the host's three gates (an order card, a generic approval, a question) wait on the operator until answered
export const needsAnswer = m => ['card', 'approval', 'question'].includes(m.kind) && !m.answer;
