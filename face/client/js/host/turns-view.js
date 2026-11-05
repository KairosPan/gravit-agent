// face/client/js/host/turns-view.js — the turn rail and the conversation's figures as the page draws them (plan 5): the
// rail's ticks from the `turnOutline` projection, the turn the view is on, the figures from `sessionStats` with the
// window's `tokenUsage`, the head's two pills, and the token, duration and clock formats Usage and a job read. Pure.
import { t, tn } from '../i18n/words.js';

// {show, ticks: [{turn, seq, loaded, prompt, response}]}: a tick is loaded when nothing is earlier than the window or its
// turn starts inside it (paging back through its seq brings the whole turn)
export function railView(conv) {
  const outline = Array.isArray(conv?.outline) ? conv.outline : [];
  const w = conv?.window;
  const ticks = outline.map(({ turn, seq, prompt, response }) => ({
    turn, seq, loaded: !w || w.hasMore !== true || seq >= w.start, prompt, response,
  }));
  return { show: conv?.loaded === true && ticks.length >= 2, ticks };
}

// marks [{turn, top}] in document order: the last whose top is at or above the view's top (8 px of slack), else the first
export function activeTurn(marks, scrollTop) {
  if (!Array.isArray(marks) || marks.length === 0) return null;
  let on = marks[0].turn;
  for (const m of marks) if (m.top <= scrollTop + 8) on = m.turn;
  return on;
}

const num = v => (Number.isFinite(v) ? v : 0);
// one decimal is rounded on whole hundreds, not by toFixed, so 9,950 is 10.0 and not 9.9

// null until a step has closed; else the figures, each null when its denominator is 0 (tokens null without a tokenUsage);
// a zero model, tool or first-token time is no figure
export function statsView(stats, tokenUsage) {
  if (!stats || !(stats.steps >= 1)) return null;
  const usage = tokenUsage && typeof tokenUsage === 'object' ? tokenUsage : null;
  const input = usage ? num(usage.uncachedInputTokens) + num(usage.cacheReadTokens) : 0;
  return {
    turns: stats.turns,
    steps: stats.steps,
    speed: stats.decodeMs > 0 ? Math.round(stats.decodeTokens / (stats.decodeMs / 1000)) : null,
    tokens: usage ? input + num(usage.outputTokens) : null,
    cache: input > 0 ? num(usage.cacheReadTokens) / input : null,
    modelMs: stats.llmMs > 0 ? stats.llmMs : null,
    toolMs: stats.toolMs > 0 ? stats.toolMs : null,
    firstTokenMs: stats.ttftSteps > 0 && stats.ttftMs > 0 ? stats.ttftMs / stats.ttftSteps : null,
  };
}

// [`7 turns · 41 steps · 38 tok/s`, `182k tokens · cache 63%`], a part with no figure left out
export function pillsText(view) {
  if (!view) return ['', ''];
  const first = [tn('details.pill.turns', view.turns), tn('details.pill.steps', view.steps)];
  if (view.speed !== null) first.push(t('details.speedValue', { n: view.speed }));
  const second = [];
  if (view.tokens !== null) second.push(t('details.pill.tokens', { count: compactTokens(view.tokens) }));
  if (view.cache !== null) second.push(t('details.pill.cache', { pct: Math.round(view.cache * 100) }));
  return [first.join(' · '), second.join(' · ')]; // words-order: the pills' figures under the visual separator
}

// 999, 4.2k, 182k, 1.3M; the unit is chosen after rounding, so 9,999 is 10k and 999,999 is 1.0M
export function compactTokens(n) {
  const v = num(n);
  if (v < 1000) return String(v);
  const tenth = Math.round(v / 100) / 10;
  if (tenth < 10) return `${tenth.toFixed(1)}k`;
  const k = Math.round(v / 1000);
  if (k < 1000) return `${k}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

const pad = n => String(n).padStart(2, '0');
const hours = secs => t('time.duration.hours', { h: Math.floor(secs / 3600), m: pad(Math.floor(secs / 60) % 60) });
const minutes = secs => t('time.duration.minutes', { m: Math.floor(secs / 60), s: pad(secs % 60) });

// Usage's times: 1.4 s, 42 s, 4m 12s, 1h 04m, their units the table's; the unit is chosen after rounding, so 9,999 ms is 10 s
export function durationText(ms) {
  const v = Math.max(0, num(ms));
  const tenth = Math.round(v / 100) / 10;
  if (tenth < 10) return t('time.duration.seconds', { n: tenth.toFixed(1) });
  const secs = Math.max(10, Math.floor(v / 1000));
  if (secs < 60) return t('time.duration.seconds', { n: secs });
  if (secs < 3600) return minutes(secs);
  return hours(secs);
}

// a job's running time: 42s, 3m 04s, 1h 04m
export function clockText(ms) {
  const secs = Math.max(0, Math.floor(num(ms) / 1000));
  if (secs < 60) return t('time.clock.seconds', { n: secs });
  if (secs < 3600) return minutes(secs);
  return hours(secs);
}
