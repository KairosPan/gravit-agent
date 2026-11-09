/** Pure frame → view-model mapping: the tested half of the client.
 *
 * No DOM, no network, no state — one frame in, one view-model out, so the
 * decoding of the harness wire format is testable without a browser and the
 * renderer stays a dumb consumer of `kind`.
 *
 * WHAT ARRIVES (dsh 0.2.0-rc.2). There is no all-session envelope any more:
 * `client/api.js` carries three logical streams on `/api/remote.mux`, and each
 * item reaches this module in one of these shapes:
 *   `{type:"session/event", sessionId, event}`      one durable session event: a
 *       `session/follow` item or snapshot record, which arrive as `{type:"event",
 *       event}` and name no session, re-addressed by the caller that opened the
 *       follow (NEW packages/api/session-controller/src/types.ts:425-429, 552-563).
 *       The raw `{type:"event", event}` record, `sessionId` added or not, maps the
 *       same - the one mapping that keeps a backfilled transcript identical to a
 *       streamed one.
 *   `{type:"assistant-stream", sessionId, frame}`   a live, NOT durable model frame
 *       from a follow opened with `assistantStream: true` (types.ts:513-543).
 *   `{type:"waterfall", event, eventId, agentId, request}` / `{type:"cancel", eventId}`
 *       an operator gate and its withdrawal, from `$events`
 *       (NEW packages/api/gateway/src/stream-protocol.ts:52-64).
 *   `{type:"projection", sessionId, key, value, seq}`   a `session/control`
 *       projection update (session-controller/src/types.ts:566-581, control.ts:22-30).
 * Everything else maps to `ignore`: the control `baseline` and the follow
 * `snapshot` (the caller seeds from them), `$events` `ready`/`emit` (api.js
 * routes them), mux `item`/`end`/`error` frames - and every 0.1.1 shape, the
 * `server-request` envelope first, so a stale host renders nothing rather than
 * something half-right.
 *
 * Shapes are pinned to `@deepseek-ai/dsh-*@0.2.0-rc.2`:
 *   gate frames       dsh-api-gateway     lib/types/stream-protocol.d.ts (RemoteEvent*Frame)
 *   follow/control    dsh-api-session-controller lib/types/types.d.ts (SessionFollowFrame, SessionControlFrame)
 *   session event     dsh-session         src/types.ts:281-523 (SessionEventMap, SurfaceOp)
 *   message/content   dsh-llm             src/message.ts, src/types.ts (ToolResultMessage, StreamChunk)
 *   approval request  dsh-user-approval   src/types.ts:63-76 (ApprovalRequestEvent)
 *   question request  dsh-user-questions  src/types.ts:129-146 (AskUserQuestionRequestEvent)
 * Stored 0.1.1 logs reach this module already migrated to format v4 on read
 * (NEW packages/session/session-format-v3-to-v4), so it never meets a v3 shape.
 * On a pin bump, re-read those and correct this file AND tests/fixtures/events.jsonl.
 * @module
 */

/**
 * How a surface event entered the transcript: appended to the tail, or
 * replacing an inclusive seq range that must stop being shown.
 * @typedef {"append"|{op: "replace", start: number, end: number}} SurfaceOpView
 */

/**
 * A completed or pending tool call, as one card.
 * @typedef {object} ToolCardView
 * @property {"call"|"result"} phase - `call` announces the invocation, `result` completes it.
 * @property {string} [callId] - pairs the two phases; absent only on a malformed event.
 * @property {string} [name] - the tool's name. Present on `call` ONLY: `tool/result`
 *   carries the message, not the name, so a renderer titles a result from the call it remembers.
 * @property {string} [title] - `call` only: a one-line account derived from the call
 *   itself - a `bash` call's command, else the tool name. Host presenters no longer
 *   reach the client (NEW packages/client/ui-tool/README.md:52), so there is no host title.
 * @property {string} [text] - result text, model-facing text blocks joined (`result` phase).
 * @property {boolean} [isError] - whether the tool reported failure.
 */

/**
 * One frame's whole meaning to the UI. A closed `kind` vocabulary with optional
 * payload fields: a renderer switches on `kind` and reads only its own fields.
 * @typedef {object} FrameView
 * @property {"bubble"|"card"|"approval"|"question"|"gate-resolved"|"pulse"|"projection"|"room-line"|"desk-line"|"subagent-message"|"turn"|"ignore"} kind
 * @property {number} [seq] - the session event's seq; the renderer's dedupe key across backfill and stream.
 * @property {number} [time] - the session event's `time` (unix ms, SessionEvent in dsh-session's types):
 *   the clock a renderer dates the message by. Gate, pulse, projection and turn views carry none.
 * @property {string} [sessionId] - which session this belongs to (absent when the frame names none).
 *   Gates: the waterfall's `agentId`, which IS the session id (NEW packages/core/agent/src/index.ts:258-270).
 * @property {SurfaceOpView} [surfaceOp] - on every rendered session event: `append`, or a
 *   replace instruction the renderer MUST honour by dropping the shadowed range.
 * @property {"operator"|"gravit"|"bot"} [role] - bubble side; `bot` is a room member speaking in its own voice.
 * @property {string} [text] - bubble text; a room or desk line's whole message, as the session got it.
 * @property {boolean} [interrupted] - bubbles: the turn was cancelled mid-stream and this is
 *   only the prefix that had arrived. Never render a partial answer as a complete one.
 * @property {string} [source] - who produced the message: `user`, `model`, `tool`, `room`,
 *   `telegram` (the operator, from the phone; the desk's `schedule` and `alert` are desk lines),
 *   a first-party producer kind (`compact-checkpoint`, `runtime-context`,
 *   `agent-instructions`, …), a migrated `plugin:<name>`, `agent-message` or
 *   `subagent-report` (child-authored), or `subagent-settled` (runtime-authored).
 *   {@link isInjectedSource} says which of them render as a context row.
 * @property {number} [from] - telegram bubbles: the sender's Telegram user id.
 * @property {number} [chat] - telegram bubbles: the Telegram chat the message came in.
 * @property {number} [messageId] - telegram bubbles: the message's id in that chat.
 * @property {"telegram"|"slack"|"imessage"} [network] - telegram bubbles: the network an account inbox's text came through.
 * @property {string} [said] - telegram bubbles: a reply's own words, apart from the context it replies to.
 * @property {string} [order] - desk-line `schedule`: the standing order that fired.
 * @property {string} [firing] - desk-line `schedule`: the firing's key.
 * @property {string} [date] - desk-line `schedule`: the trading date it fired for.
 * @property {string} [alert] - desk-line `alert`: the alert's id.
 * @property {string} [symbol] - desk-line `alert`: the symbol it is about.
 * @property {Array<Record<string, unknown>>} [attachments] - operator bubbles, present only when the message
 *   holds one: `{type:'image', attachmentId, mediaType, bytes, width, height, name?, offloaded?: true}` or
 *   `{type:'file', attachmentId, name, bytes}`, in the message's order.
 * @property {string} [thinking] - gravit bubbles: the message's reasoning blocks, joined.
 *   Thinking is never chat text; a renderer shows it apart from the bubble or not at all.
 * @property {string} [mode] - pulses: which block kind just opened live — `reasoning`, `text`, `tool-call`.
 * @property {ToolCardView} [card] - the card body.
 * @property {string} [id] - gates and gate-resolved: the `$events` `eventId`, the one id
 *   `mux.answer` names. The same across reconnects, so a replayed gate dedupes by it.
 * @property {string} [toolName] - approvals: the tool awaiting permission.
 * @property {string} [callId] - approvals: the call awaiting permission. There is no
 *   audit `approvalId` on the wire any more; the log correlates by this callId.
 * @property {string} [reason] - approvals: why permission is being asked, when the host said;
 *   turn views: the TurnEndReason's `kind` (`completed`, `aborted`, `interrupted`, …), when the frame carries one.
 * @property {string} [displayReason] - approvals: the host's English presentation text,
 *   when it sent one (sandbox escalations always do; never persisted: user-approval/src/types.ts:72-73).
 * @property {unknown[]} [questions] - questions: the AskUserQuestionItem batch (one ask, many questions, ONE answer).
 * @property {string} [outcome] - room-line: the round's `RoundOutcome`. A gate-resolved view
 *   carries none: a `cancel` frame says only that the gate is over.
 * @property {string} [key] - projections: which unit changed — `tokenUsage`,
 *   `contextPressure`, `title`, … The renderer stores whole values per key,
 *   higher `seq` winning; the frame is a state broadcast, not a delta.
 * @property {unknown} [value] - projections: the unit's whole new view value.
 * @property {string} [bot] - a room member's roster id: bubbles with `role: "bot"`.
 * @property {string} [name] - a room member's display name: bubbles with `role: "bot"`.
 * @property {string} [memberSessionId] - the member's own session, distinct from this room's sessionId.
 * @property {number} [memberTurn] - the exact member turn that produced this answer.
 * @property {unknown} [roomView] - the member's structured account, read from source metadata only.
 * @property {string} [displayText] - the readable answer body supplied by the room producer; text retains the original.
 * @property {string} [viewIssue] - the producer could not fully record the member's account.
 * @property {unknown} [discussion] - the round's brief and attributed accounts, before renderer validation.
 * @property {string} [form] - the wire `source.form`, when present; subagent messages retain
 *   `relay` (report) or `notice` (settlement), distinct from their rendered `line`.
 * @property {string[]} [mention] - operator bubbles: the roster ids the operator's `@` addressed.
 * @property {string} [line] - room-line: `round-end`; desk-line: `schedule` or `alert`;
 *   subagent-message: `report` or `settled`.
 * @property {string} [childSessionId] - subagent-message: the source's explicit senderSessionId,
 *   never inferred from text or replaced by this parent session's id.
 * @property {string} [summary] - subagent-message: the runtime's settlement summary, if recorded.
 *   The wire source does not carry a structured outcome or result; do not infer one from prose.
 * @property {number} [round] - room-line: the round number that ended.
 * @property {unknown[]} [turns] - room-line: every member's `RoomTurnRecord` for the round.
 * @property {"start"|"end"} [phase] - turn: which boundary this is.
 * @property {number} [turn] - turn: the turn number opening or closing.
 */

/** The desk's own message kinds (src/desk-session.ts `DeskMessageSource`): the
 * operator's phone, and the face's clock and watch. Each is drawn in its own
 * shape - a phone message as the operator's bubble, a firing or an alert as a
 * desk line - never as an injected context row. */
const DESK_KINDS = new Set(["telegram", "schedule", "alert"]);

/**
 * Whether a user-role message's source kind is an INJECTION: words the
 * operator did not write and no turn's opener - instructions, a file-change
 * notice, skill content, the runtime's context, a room member's delta, the
 * desk's state - drawn as one collapsed context row (chat.js `bubbleNode` and
 * `accept`, member-traces.js). That is every kind but the operator's own
 * `user` and the desk's three; a kind nobody knows yet is one too, so an
 * unknown producer's words never pass for the operator's. No kind at all is
 * none (the mapper reports none, and the bubble stays the operator's).
 * @param {unknown} kind - a view's `source`.
 * @returns {boolean}
 */
export function isInjectedSource(kind) {
  return typeof kind === "string" && kind !== "user" && !DESK_KINDS.has(kind);
}

/** @param {unknown} value @returns {boolean} true for a non-null, non-array object. */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} true for a string with at least one character. */
function isId(value) {
  return typeof value === "string" && value !== "";
}

/** A view that renders nothing. Built fresh each call so no caller can alias it. @returns {FrameView} */
function ignore() {
  return { kind: "ignore" };
}

/**
 * Join the visible text of a content-block list. `reasoning` blocks are
 * deliberately excluded — thinking is not chat — and so is everything with no
 * text of its own (images, files, tool calls).
 * @param {unknown} blocks - a ContentBlock[], or anything else.
 * @returns {string} the joined text, possibly empty.
 */
function blocksText(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => isObject(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** A finite number, for an attachment's size fields. @param {unknown} value @returns {boolean} */
const isCount = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * The message's image and file blocks, in order, beside {@link blocksText}: an image
 * block is `{type:'image', attachment:{attachmentId, mediaType, bytes, width, height,
 * name?}, offloaded?}`, a file block `{type:'file', attachment:{attachmentId, name,
 * bytes}}` (dsh-llm's content blocks). `offloaded: true` is kept when a block carries it,
 * but a replayed user/message rarely does: dsh keeps the image's bytes, and an offload is
 * a separate image/offload event that leaves the message events as they were. A block with no
 * attachmentId is dropped; every other field is kept only in the shape the host
 * writes it, never guessed.
 * @param {unknown} blocks - a ContentBlock[], or anything else.
 * @returns {Array<Record<string, unknown>>} possibly empty.
 */
function blocksAttachments(blocks) {
  if (!Array.isArray(blocks)) return [];
  const out = [];
  for (const block of blocks) {
    if (!isObject(block) || (block.type !== "image" && block.type !== "file") || !isObject(block.attachment)) continue;
    const a = block.attachment;
    if (!isId(a.attachmentId)) continue;
    if (block.type === "image") {
      out.push({
        type: "image", attachmentId: a.attachmentId,
        ...pick(a, ["mediaType"], isId), ...pick(a, ["bytes", "width", "height"], isCount), ...pick(a, ["name"], isId),
        ...(block.offloaded === true ? { offloaded: true } : {}),
      });
    } else {
      out.push({ type: "file", attachmentId: a.attachmentId, ...pick(a, ["name"], isId), ...pick(a, ["bytes"], isCount) });
    }
  }
  return out;
}

/** The message's reasoning blocks, joined — the model's thinking, never chat
 * text (NEW packages/llm/llm/src/types.ts:67-71: same `text` field, its own type).
 * @param {unknown} blocks @returns {string} */
function blocksReasoning(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .filter((block) => isObject(block) && block.type === "reasoning" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * Where a surface event sits in the transcript.
 *
 * `surfaceOp` lives on the session EVENT, and only on the surface types
 * (NEW packages/core/session/src/types.ts:432-464; wire type
 * session-controller/src/types.ts:445-448). Absent means `append` — which is
 * also what every log-only event and every `tool/call` is, since surface
 * metadata is forbidden on them (session types.ts:493-516).
 *
 * The range is `startSeq`..`endSeq`, inclusive; 0.1.1's `start`/`end` spelling
 * is gone, and v4 rewrites stored references on read, so a replace that still
 * spells them is malformed and reads as `append`. Downstream the view keeps its
 * `{op:'replace', start, end}` shape, which the renderer consumes.
 *
 * A `replace` is not cosmetic: compaction writes its checkpoint as a
 * `user/message` whose op replaces the range it summarized (source kind
 * `compact-checkpoint`, NEW packages/compaction/compaction/src/checkpoint.ts:19-42),
 * and a renderer that ignores it shows the summary AND everything it summarized.
 * @param {Record<string, unknown>} event - the session event.
 * @returns {SurfaceOpView} the normalized op; malformed input reads as `append`.
 */
function surfaceOpOf(event) {
  const op = event.surfaceOp;
  if (isObject(op) && op.op === "replace" && typeof op.startSeq === "number" && typeof op.endSeq === "number") {
    return { op: "replace", start: op.startSeq, end: op.endSeq };
  }
  return "append";
}

/**
 * One message as a bubble, or nothing when it has no text. A textless message
 * is real and normal — an assistant message that exists only to host usage or
 * tool calls (session types.ts:333-353) — and an empty bubble would be a lie
 * about what was said. An operator message that holds an image or a file is a
 * bubble even with no words: its attachments ride on it (`attachments`). One v1
 * limitation shares the drop — only in theory, since every producer of one frames
 * a summary — a textless REPLACE node, whose shadow instruction would be dropped with it.
 * @param {"operator"|"gravit"} role - which side of the flow.
 * @param {unknown} message - the LLM Message wrapper.
 * @param {FrameView} base - seq/sessionId/surfaceOp already read off the event.
 * @param {boolean} interrupted - whether this is a cancelled turn's prefix.
 * @returns {FrameView}
 */
function bubble(role, message, base, interrupted) {
  const text = isObject(message) ? blocksText(message.content) : "";
  const thinking = role === "gravit" && isObject(message) ? blocksReasoning(message.content) : "";
  const src = isObject(message) && isObject(message.source) ? message.source : {};
  const kind = typeof src.kind === "string" ? src.kind : undefined;
  const form = typeof src.form === "string" ? src.form : undefined;
  /* A continuable child reports through an ordinary user/message, but no report
   * is an operator prompt. 0.2.0 writes the child's report as an adjacent-agent
   * RELAY, `{kind:'agent-message', form:'relay', senderSessionId}`, while a log
   * migrated from 0.1.1 keeps `subagent-report` by name
   * (NEW packages/subagent/subagent/src/continuation-messages.ts:15-21, 46-52;
   * session-format-v3-to-v4/src/sources.ts:48-56). Both are the report `line`;
   * an `agent-message` in any other form is not a report and stays a context row.
   * The runtime's settlement notice stays apart from both: it records only
   * senderSessionId, form and a summary (continuation-messages.ts:24-38), and
   * none of these carries a structured outcome/result to guess from prose.
   * Recognized kinds with older/malformed metadata still retain their own
   * attribution and full text; only an explicitly recorded id becomes a link. */
  const report = kind === "subagent-report" || (kind === "agent-message" && form === "relay");
  if (role === "operator" && (report || kind === "subagent-settled")) {
    const summary = kind === "subagent-settled" && typeof src.summary === "string" && src.summary.trim() !== ""
      ? src.summary : undefined;
    if (text === "" && summary === undefined) return ignore();
    return {
      ...base, kind: "subagent-message", line: report ? "report" : "settled",
      source: kind, form, text,
      ...(typeof src.senderSessionId === "string" && src.senderSessionId.trim() !== ""
        ? { childSessionId: src.senderSessionId } : {}),
      ...(summary === undefined ? {} : { summary }),
    };
  }
  // only the operator's own words carry their attachments: never Gravit's, a room's, a desk line's or a context row's
  const attachments = role === "operator" && !isInjectedSource(kind) && kind !== "schedule" && kind !== "alert"
    ? blocksAttachments(isObject(message) ? message.content : undefined) : [];
  if (text === "" && thinking === "" && attachments.length === 0) return ignore();
  /* A room-sourced user message is one of three things (plan 2, deviation 1):
   * a member's ANSWER (a bubble in the bot's own voice), the ROUND END (a
   * line), or - in a member's own session - the DELTA it was prompted with
   * (an injected context row, like every other producer-sourced message). v4
   * keeps the face's direct `room` kind as written
   * (session-format-v3-to-v4/src/sources.ts:92-106). */
  if (role === "operator" && kind === "room") {
    if (form === "answer" && typeof src.bot === "string") {
      return {
        ...base, kind: "bubble", role: "bot", bot: src.bot,
        name: typeof src.name === "string" && src.name !== "" ? src.name : src.bot,
        form, text, interrupted: false, source: kind,
        memberSessionId: typeof src.sessionId === "string" ? src.sessionId : undefined,
        memberTurn: typeof src.turn === "number" ? src.turn : undefined,
        ...(src.view === undefined ? {} : { roomView: src.view }),
        ...(typeof src.displayText === "string" ? { displayText: src.displayText } : {}),
        ...(typeof src.viewIssue === "string" ? { viewIssue: src.viewIssue } : {}),
      };
    }
    if (form === "round-end") {
      return { ...base, kind: "room-line", line: "round-end", round: typeof src.round === "number" ? src.round : undefined, outcome: typeof src.outcome === "string" ? src.outcome : undefined, turns: Array.isArray(src.turns) ? src.turns : [], text,
        ...(src.discussion === undefined ? {} : { discussion: src.discussion }),
      };
    }
  }
  /* The desk's sources (src/desk-session.ts `DeskMessageSource`). A firing of
   * the face's clock (`schedule`) or an alert of its watch (`alert`) is the
   * face's words, no operator's: a desk LINE, as a round's end is a room line,
   * carrying its own fields. A phone message (`telegram`) is the operator's own
   * words: the generic operator bubble below, plus who sent it from where.
   * Every field is kept only in the shape the face writes it, never guessed. */
  if (role === "operator" && (kind === "schedule" || kind === "alert")) {
    return { ...base, kind: "desk-line", line: kind, text, ...pick(src, DESK_LINE_FIELDS[kind], isId) };
  }
  const mention = kind === "user" && Array.isArray(src.mention) ? src.mention.filter((m) => typeof m === "string") : undefined;
  return {
    ...base,
    kind: "bubble",
    role,
    text,
    interrupted,
    source: kind,
    form,
    // a task's message (one-entry plan 2): the task a relay names and the status it reports, as the face writes them
    ...(kind === "task" ? pick(src, ["task", "status"], isId) : {}),
    ...(mention !== undefined && mention.length > 0 ? { mention } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(role === "operator" && kind === "telegram"
      ? { ...pick(src, PHONE_FIELDS, Number.isSafeInteger), ...pick(src, ["network"], isPhoneNetwork), ...phoneSaid(message) } : {}),
    thinking: thinking === "" ? undefined : thinking,
  };
}

/** A phone message's fields: the Telegram sender, the chat and the message's
 * id there - integers, as the retired Telegram bridge wrote them. A text the
 * account's inbox brings (src/phone-bridge.ts) carries `network` and a string
 * `messageId` instead: the bubble keeps the network ({@link isPhoneNetwork}) and not the id, so none of these is picked. */
const PHONE_FIELDS = ["from", "chat", "messageId"];

/** The networks a phone text comes through (src/phone-bridge.ts): its bubble keeps the one it names. */
const isPhoneNetwork = (value) => value === "telegram" || value === "slack" || value === "imessage";

/** The line a phone reply's context opens with (src/desk-conversation.ts `CONTEXT_HEAD`). */
const CONTEXT_HEAD = "the message this replies to:"; // en-kept: the face's wire text, never on screen

/** A phone reply's own words (src/desk-conversation.ts `phoneContent`): a text that replies to an alert is three text
 * parts - the provenance line, the context headed {@link CONTEXT_HEAD}, then the operator's words - kept here as `said`,
 * since the joined text no longer says where the context ends. Any other shape keeps nothing.
 * @param {unknown} message @returns {{said?: string}} */
function phoneSaid(message) {
  const parts = isObject(message) && Array.isArray(message.content) ? message.content.filter((b) => isObject(b) && b.type === "text" && typeof b.text === "string") : [];
  if (parts.length !== 3 || !parts[1].text.startsWith(`${CONTEXT_HEAD}\n`)) return {};
  return { said: parts[2].text.trim() };
}

/** A desk line's fields by its kind: a firing's standing order, its key and
 * the trading date it fires for; an alert's id and its symbol - strings. */
const DESK_LINE_FIELDS = { schedule: ["order", "firing", "date"], alert: ["alert", "symbol"] };

/** The named fields of `src` that `keep` accepts, and only those - a field
 * missing or malformed is left out, never `undefined`.
 * @param {Record<string, unknown>} src @param {string[]} names
 * @param {(value: unknown) => boolean} keep @returns {Record<string, unknown>} */
function pick(src, names, keep) {
  return Object.fromEntries(names.filter((name) => keep(src[name])).map((name) => [name, src[name]]));
}

/**
 * The one-line account of a tool call, from the call alone. The host renders
 * tool cards through presenters that never reach this client
 * (NEW packages/client/ui-tool/README.md:52), so the title is derived here: a
 * `bash` call's `command` argument (NEW packages/shell/tool-bash/src/index.ts:374-377),
 * else the tool's name. `arguments` is the model's raw JSON string, unparsed and
 * possibly malformed (session types.ts:356-361), so a parse failure falls back
 * to the name rather than guessing.
 * @param {string|undefined} name - the tool name.
 * @param {unknown} args - the raw arguments string.
 * @returns {string|undefined}
 */
function callTitle(name, args) {
  if (name === "bash" && typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (isObject(parsed) && typeof parsed.command === "string" && parsed.command.trim() !== "") return parsed.command.trim();
    } catch {
      // not JSON: the model's own malformed arguments; the name says enough
    }
  }
  return name;
}

/**
 * Map one session event (streamed or backfilled) to its view.
 * @param {Record<string, unknown>} frame - `{sessionId?, event}`.
 * @returns {FrameView}
 */
function mapSessionEvent(frame) {
  const event = frame.event;
  if (!isObject(event) || typeof event.type !== "string") return ignore();
  const data = isObject(event.data) ? event.data : {};
  /** @type {FrameView} */
  const base = {
    kind: "ignore",
    seq: typeof event.seq === "number" ? event.seq : undefined,
    // Present only when the event carries one: a view compares by its own keys.
    ...(typeof event.time === "number" && Number.isFinite(event.time) ? { time: event.time } : {}),
    sessionId: typeof frame.sessionId === "string" ? frame.sessionId : undefined,
    surfaceOp: surfaceOpOf(event),
  };

  switch (event.type) {
    case "user/message":
      // The event data IS the message here (SessionEventMap['user/message'] = UserMessage).
      // An operator prompt is committed the moment it is logged: never interrupted.
      return bubble("operator", data, base, false);
    case "assistant/message":
      // interrupted marks a turn cancelled mid-stream: what follows is the
      // delivered PREFIX, not the answer (session types.ts:333-353). The
      // embedded `stream` record list is the model's raw timing; not rendered.
      return bubble("gravit", data.message, base, data.interrupted === true);
    case "tool/call": {
      const name = typeof data.name === "string" ? data.name : undefined;
      return { ...base, kind: "card", card: {
        phase: "call",
        callId: typeof data.callId === "string" ? data.callId : undefined,
        name,
        title: callTitle(name, data.arguments),
      } };
    }
    case "tool/result": {
      // A first-class tool-role message: its own toolCallId and isError, the
      // result blocks inline (NEW packages/llm/llm/src/message.ts:172-180,
      // 299-306); 0.1.1's single wrapped tool-result block is gone. The
      // source's callId is the same id by construction, kept as the fallback.
      const message = isObject(data.message) ? data.message : {};
      const sourceCallId = isObject(message.source) ? message.source.callId : undefined;
      const callId = isId(message.toolCallId) ? message.toolCallId
        : isId(sourceCallId) ? sourceCallId : undefined;
      return { ...base, kind: "card", card: {
        phase: "result",
        callId,
        text: blocksText(message.content),
        // Either channel means failure: the message's own flag, or an internal
        // failure identity on the event (session types.ts:362-389).
        isError: message.isError === true || isObject(data.error),
      } };
    }
    case "turn/start":
    case "turn/end": {
      const reason = isObject(data.reason) && typeof data.reason.kind === "string" ? data.reason.kind : undefined;
      return { ...base, kind: "turn", phase: event.type === "turn/start" ? "start" : "end", turn: typeof data.turn === "number" ? data.turn : undefined, ...(reason === undefined ? {} : { reason }) };
    }
    default:
      // Every other session event type is log-only for v1: step boundaries,
      // request headers, approval audit, permission pins, compaction markers,
      // model selection, and 0.1.1's `assistant/chunk`, which 0.2.0 no longer
      // logs at all (live chunks ride the follow's assistant stream instead).
      return ignore();
  }
}

/**
 * A live model frame: pulse when a content block OPENS, the one live signal
 * worth surfacing - it says what the model is doing right now (reasoning /
 * text / tool-call) while nothing settled has landed yet. Every other frame
 * (`start`, the deltas, `end`) is ignored (session-controller/src/types.ts:513-543;
 * chunk grammar NEW packages/llm/llm/src/types.ts:452-460).
 * @param {Record<string, unknown>} item - `{sessionId?, frame}`.
 * @returns {FrameView}
 */
function mapAssistantStream(item) {
  const frame = item.frame;
  if (!isObject(frame) || frame.type !== "chunk" || !isObject(frame.chunk)) return ignore();
  const chunk = frame.chunk;
  if (chunk.type !== "block-start" || typeof chunk.blockType !== "string") return ignore();
  return {
    kind: "pulse",
    mode: chunk.blockType,
    sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
  };
}

/**
 * An `$events` waterfall the operator answers. `id` is the `eventId` that
 * `mux.answer` must name; `sessionId` is the waterfall's `agentId`; the request
 * is the host's own request object minus `agent` and `signal`
 * (stream-protocol.ts:146-173). Any other waterfall event is not a gate here
 * (api.js hands it back with `next`).
 * @param {Record<string, unknown>} frame
 * @returns {FrameView}
 */
function mapGate(frame) {
  if (!isId(frame.eventId) || !isObject(frame.request)) return ignore();
  const request = frame.request;
  const sessionId = typeof frame.agentId === "string" ? frame.agentId : undefined;
  if (frame.event === "approval/request") {
    // ApprovalRequestEvent {toolName, callId?, reason?, displayReason?{en,…}}
    // (NEW packages/interaction/user-approval/src/types.ts:63-76).
    const display = isObject(request.displayReason) ? request.displayReason.en : undefined;
    return {
      kind: "approval",
      id: frame.eventId,
      sessionId,
      toolName: typeof request.toolName === "string" ? request.toolName : undefined,
      callId: typeof request.callId === "string" ? request.callId : undefined,
      reason: typeof request.reason === "string" ? request.reason : undefined,
      displayReason: typeof display === "string" && display !== "" ? display : undefined,
    };
  }
  if (frame.event === "user-questions/request") {
    // AskUserQuestionRequestEvent {questions, wait?} (user-questions/src/types.ts:129-146).
    return {
      kind: "question",
      id: frame.eventId,
      sessionId,
      questions: Array.isArray(request.questions) ? request.questions : [],
    };
  }
  return ignore();
}

/**
 * Map one wire frame to its view model.
 * @param {unknown} frame - a session event, assistant-stream, gate, cancel or
 *   projection item, as the module comment lists them.
 * @returns {FrameView} always a view; unrecognized input maps to `ignore`.
 */
export function mapFrame(frame) {
  if (!isObject(frame)) return ignore();
  switch (frame.type) {
    case "session/event":
    case "event":
      return mapSessionEvent(frame);
    case "assistant-stream":
      return mapAssistantStream(frame);
    case "waterfall":
      return mapGate(frame);
    /* The withdrawal, and the reason it is not ignorable: a gate the host
     * settled without this tab - another tab answered, the turn stopped, the
     * session went away - pushes ONLY this frame (gateway/src/index.ts:646-668).
     * A renderer that drops it keeps the dead card answerable forever. It names
     * the gate by the same eventId the waterfall carried, and it carries no
     * outcome and no session. */
    case "cancel":
      return isId(frame.eventId) ? { kind: "gate-resolved", id: frame.eventId } : ignore();
    case "projection": {
      // A projection unit's whole new value (session/control, control.ts:22-30):
      // the agent panel's live feed for tokenUsage/contextPressure. seq is the
      // committed event that produced it — the store's higher-wins key.
      if (typeof frame.sessionId !== "string" || typeof frame.key !== "string") return ignore();
      return {
        kind: "projection",
        sessionId: frame.sessionId,
        key: frame.key,
        value: frame.value,
        seq: typeof frame.seq === "number" ? frame.seq : undefined,
      };
    }
    default:
      // snapshot · baseline · ready · emit · item/end/error, and every 0.1.1
      // frame (server-request envelopes, session/projection, approval/requested,
      // question/*, session/subscribed, stream/error, untyped history entries).
      // Carried or dead, none of them renders.
      return ignore();
  }
}
