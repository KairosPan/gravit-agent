/** The owner's acts on the memory from the face: arm, retire or discard a lesson; accept, edit or reject a proposal;
 * void a decision - each one signed by the owner's device as an `attest` at the Account, and done only on the
 * Account's yes.
 *
 * {@link MemoryActs.prepare} says what an act is about and what to sign: it reads the memory through the face's own
 * handle (src/memory.ts `MemoryStanding`), shows what the act would act on, and drafts the `attest` whose digest
 * ({@link digestOf}) binds the act, its subject, the hashes of the content read and the owner's words: a card's file
 * and armed copy by the package's sha256 of their bytes, a proposal's or a decision's line by {@link lineHash} of the
 * line as read - never a field the line carries about itself. A card whose text would be shown cut is not acted on
 * here: its act is the terminal's. It writes nothing.
 *
 * {@link MemoryActs.perform} takes the signed envelope and, one at a time, in this order - each step that fails
 * answers and stops: the body's shape; the envelope as this act's `attest` for {@link MEMORY_SERVICE}; its nonce
 * within {@link ACT_FRESH_MS} of the face's clock and not among those done; the memory connected; the content read
 * and the digest recomputed with the body's words, equal to the signed one (an act already stale spends no
 * signature); the envelope forwarded to the Account, its `action`, `nonce` and `signature` alone, and the Account's
 * yes - a 200 whose `ok` is true; the envelope among those done; the content read again and the digest recomputed,
 * equal to the signed one; then the memory's own owner act. This is the one place in the face that calls
 * `Memory.owner`. The face holds no key and verifies no signature: the Account does, and takes an `attest` once. The
 * envelopes done are kept in process, at most {@link ACT_DONE_KEPT}, the oldest forgotten first: a first line that a
 * restart forgets.
 *
 * A refusal is one of the face's fixed sentences, the package's words through `memoryFaultWords`, or the Account's
 * own refusal: nothing a caller sends is echoed beyond an id that fits its shape. A refusal for content found changed,
 * or for the memory's own act refused at the last step, carries `changed: true`. One log line names the act and its
 * subject when it is done, and one when it ends after the Account's yes without being done.
 * @module
 */
import { createHash } from "node:crypto";
import type { DecisionLine, LessonView, Memory, ProposalLine } from "gravit-memory";
import { memoryFaultWords, type MemoryStanding } from "./memory.ts";
import { DECISION_SHAPE, LESSON_SHAPE, SCREEN_TEXT_MAX } from "./memory-screen.ts";
import type { UpstreamAnswer } from "./upstream-proxy.ts";

/** The service an owner act's `attest` names. */
export const MEMORY_SERVICE = "gravit-memory";
/** The owner's acts the face takes. */
export const ACTS = ["arm", "retire", "discard", "accept", "edit", "reject", "void"] as const;
export type Act = (typeof ACTS)[number];
/** The acts that take the owner's words. */
export const WORDED: ReadonlySet<Act> = new Set<Act>(["retire", "reject", "void"]);
/** How far from the face's clock a signed nonce may lie, either side; how long one read may take; how many
 *  envelopes done are kept. */
export const ACT_FRESH_MS = 600_000, ACT_READ_MS = 5_000, ACT_DONE_KEPT = 500;

/** A proposal id. */
const PROPOSAL_SHAPE = /^p-\d{8}-[0-9a-f]{8}$/;
/** A digest as signed: SHA-256 in lower hex. */
const DIGEST_SHAPE = /^[0-9a-f]{64}$/;
/** The most characters of the owner's words, after trimming. */
const WORDS_MAX = 500;
/** Each act's subject's shape. */
const SUBJECT_SHAPE: Readonly<Record<Act, RegExp>> = {
  arm: LESSON_SHAPE, retire: LESSON_SHAPE, discard: LESSON_SHAPE,
  accept: PROPOSAL_SHAPE, edit: PROPOSAL_SHAPE, reject: PROPOSAL_SHAPE,
  void: DECISION_SHAPE,
};

const NOT_AN_ACT = "not an act the memory's screen takes";
const SAY_WHY = "say why in your own words: 1 to 500 characters";
const NO_WORDS = "this act takes no words";
const NOT_THIS = "the envelope is not an attest of this act";
const TOO_OLD = "it was signed too long ago: prepare it again";
const DONE_ALREADY = "this was done already";
const NO_ANSWER = "the Account did not answer: nothing was done";
const CHANGED = "it changed while it was shown: nothing was done";
const TOO_LONG = "the card is too long to show whole here: use the terminal";
const LATE_WORDS = "the memory did not answer in time";
/** The Account's no when it gives no message of its own. */
const ACCOUNT_REFUSED = "the Account refused it: nothing was done";

/** What an act is asked about: the act, its subject, and the owner's words, trimmed - `""` for an act that takes
 *  none. */
export interface ActAsk { act: Act; subject: string; words: string }
/** What the act acts on, as the page shows it: a card's text whole (an arm's the file's; a discard's the file's and the
 *  armed copy's; a retire's the armed copy's), each at most `SCREEN_TEXT_MAX` characters; a proposal's line; a
 *  decision's line. */
export type ActShow =
  | { kind: "card"; lesson: string; state: string; text: string; armedText?: string }
  | { kind: "proposal"; proposal: ProposalLine }
  | { kind: "decision"; decision: DecisionLine };
/** The `attest` the owner signs, its nonce the signer's. */
export interface AttestDraft { type: "attest"; service: string; act: Act; subject: string; digest: string }
/** A refusal: its status, its sentence, the Account's own refusal when it gave one, and `changed` when the content was
 *  found changed or the memory's own act was refused at the last step - the page reads the memory again. */
export type Refused = { ok: false; status: 400 | 401 | 404 | 409 | 502 | 503 | 504; error: string; refusal?: unknown; changed?: true };

export interface MemoryActs {
  /** What the act is about and the attest to sign. For a worded act with no words yet: the content alone, `draft: null`. */
  prepare(body: unknown): Promise<{ ok: true; show: ActShow; draft: AttestDraft | null } | Refused>;
  /** The signed envelope to the Account; on its yes, the recheck and the memory's own act. One at a time. */
  perform(body: unknown): Promise<{ ok: true; act: Act; subject: string; sha256?: string; lesson?: string; path?: string } | Refused>;
}

/** A value as canonical JSON: an object's keys sorted at every depth (a key whose value is undefined left out, as
 *  `JSON.stringify` leaves it), arrays in their order, every other value as `JSON.stringify` writes it. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256, lower hex, of a line as read, as canonical JSON: every key the line holds, keys sorted at every depth,
 *  arrays in their order. Equal lines hash alike whatever their keys' order; one character apart anywhere is another
 *  hash. A line's own `sum` is one of its keys like any other, and is never trusted for the line. */
export function lineHash(line: unknown): string {
  return createHash("sha256").update(canonicalJson(line)).digest("hex");
}

/** SHA-256, lower hex, of `JSON.stringify({ v: 1, service, act, subject, content, words })`, `content`'s keys in sorted order. */
export function digestOf(ask: ActAsk, content: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(content).sort()) sorted[key] = content[key]!;
  const line = JSON.stringify({ v: 1, service: MEMORY_SERVICE, act: ask.act, subject: ask.subject, content: sorted, words: ask.words ?? "" });
  return createHash("sha256").update(line).digest("hex");
}

const refused = (status: Refused["status"], error: string): Refused => ({ ok: false, status, error });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const codeOf = (error: unknown): unknown => (isRecord(error) || error instanceof Error ? (error as { code?: unknown }).code : undefined);
/** An error of the package's kind, judged by its code as the package's are. */
const notFound = (message: string): Error => Object.assign(new Error(message), { code: "E_NOT_FOUND" });

/** The package's error as a refusal: not there 404, no home 503, a refusal of the package 409, anything else 502. */
function faultOf(error: unknown): Refused {
  const code = codeOf(error);
  const status = code === "E_NOT_FOUND" ? 404 : code === "E_NO_HOME" ? 503 : code === "E_REFUSED" || code === "E_INPUT" || code === "E_CARD" ? 409 : 502;
  return refused(status, memoryFaultWords(error));
}

/** The body's act, subject and words; `words` required of a worded act when `needWords`. */
function askOf(body: unknown, needWords: boolean): ActAsk | Refused {
  if (!isRecord(body)) return refused(400, NOT_AN_ACT);
  const { act, subject, words } = body;
  if (typeof act !== "string" || !(ACTS as readonly string[]).includes(act)) return refused(400, NOT_AN_ACT);
  const known = act as Act;
  if (typeof subject !== "string" || !SUBJECT_SHAPE[known].test(subject)) return refused(400, NOT_AN_ACT);
  if (!WORDED.has(known)) {
    return words === undefined || words === "" ? { act: known, subject, words: "" } : refused(400, NO_WORDS);
  }
  if (words === undefined) return needWords ? refused(400, SAY_WHY) : { act: known, subject, words: "" };
  if (typeof words !== "string") return refused(400, SAY_WHY);
  const trimmed = words.trim();
  const n = Array.from(trimmed).length;
  return n < 1 || n > WORDS_MAX ? refused(400, SAY_WHY) : { act: known, subject, words: trimmed };
}

/** What one act's read gives: the show and the content its digest covers, or why the act may not be asked. */
type Read = { ok: true; show: ActShow; content: Record<string, string> } | Refused;

/** A card's read: `text`, and `armedText` when given, shown whole - a text past {@link SCREEN_TEXT_MAX} characters is
 *  not signed for with its tail unseen, and the act is refused for the terminal. */
function cardRead(view: LessonView, content: Record<string, string>, text: string, armedText?: string): Read {
  if (text.length > SCREEN_TEXT_MAX || (armedText !== undefined && armedText.length > SCREEN_TEXT_MAX)) return refused(409, TOO_LONG);
  const show: ActShow & { kind: "card" } = { kind: "card", lesson: view.id, state: view.state, text };
  if (armedText !== undefined) show.armedText = armedText;
  return { ok: true, show, content };
}

/** A lesson by id; one the lessons do not hold is the package's own not-found, asked of `show`. */
async function lessonOf(memory: Memory, id: string): Promise<LessonView> {
  const view = (await memory.lessons()).lessons.find((v) => v.id === id);
  if (view !== undefined) return view;
  await memory.show(id);
  throw notFound(`lesson ${id} is not a card in the memory.`);
}

/** A proposal that waits, by id. */
async function proposalOf(memory: Memory, id: string): Promise<ProposalLine> {
  const line = (await memory.review()).proposals.find((p) => p.id === id);
  if (line === undefined) throw notFound(`proposal ${id} is not waiting in the memory: it is not there, or it is answered already.`);
  return line;
}

/** An accept's or an edit's read: the proposal's line, and the line's hash with its lesson's file hash. */
async function proposalWithFile(memory: Memory, id: string, act: "accept" | "edit"): Promise<Read> {
  const line = await proposalOf(memory, id);
  if (act === "edit" && line.what === "retire") return refused(409, `proposal ${id} proposes a retirement: it is accepted or rejected, not edited.`);
  const file = (await memory.lessons()).lessons.find((v) => v.id === line.lesson)?.file?.sha256 ?? "none";
  return { ok: true, show: { kind: "proposal", proposal: line }, content: { proposal: lineHash(line), file } };
}

/** Each act's read, shared by `prepare` and `perform`'s recheck. */
const READS: Readonly<Record<Act, (memory: Memory, subject: string) => Promise<Read>>> = {
  arm: async (memory, id) => {
    const view = await lessonOf(memory, id);
    if (view.state === "armed" || view.state === "refused") {
      return refused(409, `lesson ${id} is ${view.state}: only a card that is neither armed nor refused is armed.`);
    }
    const file = view.file;
    if (file === undefined || file.card === undefined || file.fault !== undefined) {
      return refused(409, `lesson ${id} is ${view.state} and has no file that parses as a card: there is nothing to arm.`);
    }
    return cardRead(view, { file: file.sha256 }, file.text);
  },
  discard: async (memory, id) => {
    const view = await lessonOf(memory, id);
    if (view.state !== "changed") return refused(409, `lesson ${id} is ${view.state}: only a changed card is discarded.`);
    return cardRead(view, { armed: view.armed?.sha256 ?? "none", file: view.file?.sha256 ?? "none" }, view.file?.text ?? "", view.armed?.text ?? "");
  },
  retire: async (memory, id) => {
    const view = await lessonOf(memory, id);
    if (view.state !== "armed" && view.state !== "changed" && view.state !== "broken") {
      return refused(409, `lesson ${id} is ${view.state}: only an armed, changed or broken card is retired.`);
    }
    return cardRead(view, { armed: view.armed?.sha256 ?? "none" }, view.armed?.text ?? "");
  },
  accept: (memory, id) => proposalWithFile(memory, id, "accept"),
  edit: (memory, id) => proposalWithFile(memory, id, "edit"),
  reject: async (memory, id) => {
    const line = await proposalOf(memory, id);
    return { ok: true, show: { kind: "proposal", proposal: line }, content: { proposal: lineHash(line) } };
  },
  void: async (memory, id) => {
    const shown = await memory.show(id);
    if (!("decision" in shown)) throw notFound(`decision ${id} is not in the memory.`);
    if (shown.decision.void) return refused(409, `decision ${id} is void already: a void decision is not voided again.`);
    return { ok: true, show: { kind: "decision", decision: shown.decision.line }, content: { decision: lineHash(shown.decision.line) } };
  },
};

/** What a read that took longer than {@link ACT_READ_MS} answers. */
const LATE: unique symbol = Symbol("late");

/** `work` within one timer of {@link ACT_READ_MS}: its value, its rejection, or {@link LATE}, the work left to finish. */
function within<T>(work: () => Promise<T>): Promise<T | typeof LATE> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(LATE), ACT_READ_MS);
    let started: Promise<T>;
    try {
      started = work();
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    started.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** The Account's no: its status where it is one the face passes on (400, 401, 404 or 409; a 5xx is 502, anything else
 *  409), its `refusal` when it gives one, and the refusal's message, else the face's sentence. */
function accountRefusal(status: number, body: unknown): Refused {
  const refusal = isRecord(body) ? body.refusal : undefined;
  const message = isRecord(refusal) && typeof refusal.message === "string" && refusal.message.trim() !== "" ? memoryFaultWords(refusal.message) : ACCOUNT_REFUSED;
  const passed: Refused["status"] = status === 400 || status === 401 || status === 404 || status === 409 ? status : status >= 500 ? 502 : 409;
  return refusal === undefined ? refused(passed, message) : { ...refused(passed, message), refusal };
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The memory's own act, as the last step calls it, and what its answer adds. */
async function ownerAct(memory: Memory, ask: ActAsk, content: Record<string, string>): Promise<{ sha256?: string; lesson?: string; path?: string }> {
  const { act, subject, words } = ask;
  switch (act) {
    case "arm": {
      const { sha256 } = await memory.owner.arm(subject, content.file);
      return { sha256 };
    }
    case "retire":
      await memory.owner.retire(subject, words);
      return {};
    case "discard":
      await memory.owner.discard(subject);
      return {};
    case "accept": {
      const { lesson } = await memory.owner.accept(subject);
      return { lesson };
    }
    case "edit": {
      const { lesson, path } = await memory.owner.edit(subject);
      return { lesson, path };
    }
    case "reject":
      await memory.owner.reject(subject, words);
      return {};
    case "void":
      await memory.owner.void(subject, words);
      return {};
  }
}

/** The acts over `open`, forwarding through `exchange`, on the clock `now`. */
export function createMemoryActs(deps: {
  open: () => Promise<MemoryStanding>;
  exchange: (envelope: unknown) => Promise<UpstreamAnswer>;
  log: (line: string) => void;
  now?: () => number;
}): MemoryActs {
  const now = deps.now ?? Date.now;
  /** The envelopes done, by nonce and digest, oldest first. */
  const done = new Set<string>();
  /** The performs in turn: each starts once the one before has answered. */
  let chain: Promise<unknown> = Promise.resolve();

  const remember = (key: string): void => {
    done.add(key);
    while (done.size > ACT_DONE_KEPT) done.delete(done.values().next().value!);
  };

  /** The act's content read again and its digest recomputed with the body's words: the content when it equals the
   *  signed `digest`; a content gone or no longer askable is changed; a read fault its mapping; a late read 504. */
  async function recheck(memory: Memory, ask: ActAsk, digest: string): Promise<{ ok: true; content: Record<string, string> } | Refused> {
    const changed: Refused = { ...refused(409, CHANGED), changed: true };
    let read: Read | typeof LATE;
    try {
      read = await within(() => READS[ask.act](memory, ask.subject));
    } catch (error) {
      return codeOf(error) === "E_NOT_FOUND" ? changed : faultOf(error);
    }
    if (read === LATE) return refused(504, LATE_WORDS);
    if (!read.ok || digestOf(ask, read.content) !== digest) return changed;
    return { ok: true, content: read.content };
  }

  async function prepare(body: unknown): Promise<{ ok: true; show: ActShow; draft: AttestDraft | null } | Refused> {
    const ask = askOf(body, false);
    if ("ok" in ask) return ask;
    let read: Read | typeof LATE;
    try {
      read = await within(async (): Promise<Read> => {
        const standing = await deps.open();
        if (standing.connected !== true) return refused(503, standing.say);
        return READS[ask.act](standing.memory, ask.subject);
      });
    } catch (error) {
      return faultOf(error);
    }
    if (read === LATE) return refused(504, LATE_WORDS);
    if (!read.ok) return read;
    const draft: AttestDraft | null = WORDED.has(ask.act) && ask.words === ""
      ? null
      : { type: "attest", service: MEMORY_SERVICE, act: ask.act, subject: ask.subject, digest: digestOf(ask, read.content) };
    return { ok: true, show: read.show, draft };
  }

  async function performOne(body: unknown): Promise<{ ok: true; act: Act; subject: string; sha256?: string; lesson?: string; path?: string } | Refused> {
    /* 1. The body's shape. */
    const ask = askOf(body, true);
    if ("ok" in ask) return ask;
    const envelope = (body as Record<string, unknown>).envelope;
    if (!isRecord(envelope) || !isRecord(envelope.action)) return refused(400, NOT_AN_ACT);
    /* 2. The envelope is this act's attest; nothing is forwarded otherwise. */
    const action = envelope.action;
    const nonce = action.nonce;
    if (
      action.type !== "attest" || action.service !== MEMORY_SERVICE || action.act !== ask.act || action.subject !== ask.subject
      || typeof action.digest !== "string" || !DIGEST_SHAPE.test(action.digest)
      || typeof nonce !== "number" || !Number.isSafeInteger(nonce) || nonce !== envelope.nonce
    ) return refused(400, NOT_THIS);
    const digest = action.digest;
    /* 3. Fresh on the face's clock, and not done. */
    if (Math.abs(now() - nonce) > ACT_FRESH_MS) return refused(409, TOO_OLD);
    const key = `${nonce} ${digest}`;
    if (done.has(key)) return refused(409, DONE_ALREADY);
    /* 4. The memory is connected. */
    let standing: MemoryStanding | typeof LATE;
    try {
      standing = await within(deps.open);
    } catch (error) {
      return faultOf(error);
    }
    if (standing === LATE) return refused(504, LATE_WORDS);
    if (standing.connected !== true) return refused(503, standing.say);
    const memory = standing.memory;
    /* 5. The content read and the digest recomputed before the Account is asked: an act already stale spends no
       signature, leaves no attested row and does not join those done. */
    const before = await recheck(memory, ask, digest);
    if (!before.ok) return before;
    /* 6. The Account: its yes is a 200 whose body's `ok` is true. */
    let answer: UpstreamAnswer;
    try {
      answer = await deps.exchange({ action, nonce, signature: envelope.signature });
    } catch {
      answer = { unreachable: "unreachable" };
    }
    if ("unreachable" in answer) return refused(502, NO_ANSWER);
    const said = parsed(answer.body);
    if (answer.status !== 200 || !isRecord(said) || said.ok !== true) return accountRefusal(answer.status, said);
    /* 7. Done: this envelope is not taken again. From here, an end that is not the act is logged. */
    remember(key);
    const notDone = (r: Refused): Refused => {
      deps.log(`memory: the owner's ${ask.act} of ${ask.subject} was attested and not done: ${r.error}`);
      return r;
    };
    /* 8. The content read again, the digest recomputed, equal to the signed one. */
    const again = await recheck(memory, ask, digest);
    if (!again.ok) return notDone(again);
    /* 9. The memory's own act: any throw is a 409 in its words, and the page reads the memory again. */
    let added: { sha256?: string; lesson?: string; path?: string };
    try {
      added = await ownerAct(memory, ask, again.content);
    } catch (error) {
      return notDone({ ...refused(409, memoryFaultWords(error)), changed: true });
    }
    deps.log(`memory: the owner's ${ask.act} of ${ask.subject} is done`);
    return { ok: true, act: ask.act, subject: ask.subject, ...added };
  }

  return {
    prepare,
    perform: (body) => {
      const run = chain.then(() => performOne(body));
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
  };
}
