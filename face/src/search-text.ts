/** What a conversation said: a stored session's events reduced to the lines
 * the search index holds (`search-index.ts`).
 *
 * Only what the face draws as words counts: the operator's messages (and the
 * phone's and a compaction's), Gravit's and a room member's answers, and an
 * ok `lunhui_present` call's summary, which the client shows as Gravit's
 * composed answer. Reasoning, a room's deltas, runtime snapshots, plugin
 * notices, a desk firing's `schedule` or `alert` prompt, plain tool calls and
 * results yield nothing. The shapes mirror `client/js/wire/mapper.js`
 * (`blocksText`, the `tool/call` and `tool/result` readers) and
 * `client/js/host/kinds.js` `presentLift`. Pure: no dsh import. */

import type { IndexedLine } from "./search-index.ts";

export interface StoredEvent { type: string; seq: number; time?: number; data?: unknown }

/** `message.source.kind`s of a user/message that are words (an absent source is the operator's own). */
export const WORD_SOURCES: ReadonlySet<string> = new Set(["user", "telegram", "compact-checkpoint"]);

const PRESENT_TOOL = "lunhui_present";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The text blocks of a message's content, joined with a newline and trimmed, as the mapper's `blocksText`. */
function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((b) => isObject(b) && b.type === "text" && typeof b.text === "string")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();
}

function messageOf(event: StoredEvent): Record<string, unknown> {
  return isObject(event.data) && isObject(event.data.message) ? event.data.message : {};
}

function isWords(message: Record<string, unknown>): boolean {
  const source = isObject(message.source) ? message.source : undefined;
  if (source === undefined || source.kind === undefined) return true;
  if (typeof source.kind !== "string") return false;
  return WORD_SOURCES.has(source.kind) || (source.kind === "room" && source.form === "answer");
}

/** The call id a tool/result answers: the message's `toolCallId`, else its source's `callId`. */
function resultCallId(message: Record<string, unknown>): string | undefined {
  if (typeof message.toolCallId === "string" && message.toolCallId !== "") return message.toolCallId;
  const sourceId = isObject(message.source) ? message.source.callId : undefined;
  return typeof sourceId === "string" && sourceId !== "" ? sourceId : undefined;
}

function resultOk(event: StoredEvent): boolean {
  const message = messageOf(event);
  const data = isObject(event.data) ? event.data : {};
  if (message.isError === true || isObject(data.error)) return false;
  try {
    const v: unknown = JSON.parse(blocksText(message.content));
    return isObject(v) && v.ok === true;
  } catch {
    return false;
  }
}

/** The summary of a `lunhui_present` call, or "" when it has none. */
function presentSummary(event: StoredEvent): string {
  const data = isObject(event.data) ? event.data : {};
  if (data.name !== PRESENT_TOOL) return "";
  let args: unknown = data.arguments;
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return ""; }
  }
  return isObject(args) && typeof args.summary === "string" ? args.summary.trim() : "";
}

export function linesOf(events: readonly StoredEvent[]): IndexedLine[] {
  const failed = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool/result") continue;
    const id = resultCallId(messageOf(event));
    if (id !== undefined && !resultOk(event)) failed.add(id);
  }
  const lines: IndexedLine[] = [];
  for (const event of events) {
    let text = "";
    if (event.type === "user/message") {
      // the event's data IS the message here (mapper.js: SessionEventMap['user/message'] = UserMessage)
      const message = isObject(event.data) ? event.data : {};
      if (isWords(message)) text = blocksText(message.content);
    } else if (event.type === "assistant/message") {
      text = blocksText(messageOf(event).content);
    } else if (event.type === "tool/call") {
      const data = isObject(event.data) ? event.data : {};
      const id = typeof data.callId === "string" ? data.callId : undefined;
      if (id === undefined || !failed.has(id)) text = presentSummary(event);
    }
    if (text !== "") lines.push({ seq: event.seq, at: event.time ?? 0, text });
  }
  return lines;
}
