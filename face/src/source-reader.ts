// face/src/source-reader.ts
/** The source reader's `web_fetch` and its three fences (analogs spec §6.5; charter A1 and D29). The source reader is
 * the one role that reads the open web (roles/source-reader, src/roles.ts `WEB_ROLE_IDS`): its mask is `web_search`
 * alone, and this module gives each of its children dsh's own `web_fetch` - the one place, beside the desk, where the
 * open web reaches a session - and holds three fences around it in code.
 *
 * WHERE `web_fetch` REGISTERS: into each reader child's OWN tool layer, as the desk's does (src/desk-tools.ts
 * `installDeskTools`, whose listener and sweep this module shares through `equipAgents`): one root `agent/created`
 * listener and one sweep of the agents already live, each agent on `role-source-reader` given the tool once through a
 * child plugin that injects `web` (`webFetchLayer`). The role's preset carries an allow mask, and a mask filters every
 * layer an agent inherits - the global one and its preset's alike - so a `web_fetch` registered there would be hidden
 * by the mask, and a mask that named it would show it to nothing: the tree registers none (src/policy.ts D6). An
 * agent's own registrations are the one layer no restriction filters, so no `role.yml` names `web_fetch`, the global
 * view never lists it, and the tool unwinds with the child.
 *
 * WHAT THE GUARD DENIES: one `tools.guard`, armed through `ctx.inject(["tools"], …)` as the desk's backstop is, so a
 * registry that is replaced gets it again; dsh consults it on every call the `tools/pre-execute` waterfall allowed,
 * once, and no guard can force-allow a call another denied. It denies
 * - a reader's call, of any tool, whose arguments carry a secret of the face's environment (`deskSecrets`, the values
 *   of every variable named for a key, a password, a secret or a token, taken once at install): `the source reader
 *   never sends a secret; nothing was sent` - so no key leaves in a URL or a query;
 * - a reader's `web_fetch` past the fortieth that agent was allowed: `the source reader opens at most 40 pages a call;
 *   report what you have and mark the rest UNVERIFIED` - a reader child lives for one `role_source_reader` call, so
 *   the budget is per call; a call is counted once, however often the guard is asked about it;
 * - any agent's `role_source_reader` call whose arguments carry a secret: `the brief to the source reader carries a
 *   secret of the face's environment; nothing was sent` - so no key reaches a reader to be sent on;
 * - a call it could not judge, whose answer could have been a deny: `the face could not check this call; nothing was
 *   sent`, with one line.
 * A reader is an agent whose preset `ctx.agentPresets.composedPreset(agent.ctx)` reads as `role-source-reader`, or whose
 * session was created on it (its header's `agentPreset`) - the session's word standing alone when the registry throws.
 * A call no fence could deny - not a `web_fetch`, not the reader's tool, carrying no secret - is let go at the cost of a
 * name check and a look for the secrets, and never reaches the registry.
 *
 * WHAT THE RECORD NOTES: one root `tools/execute` listener. dsh runs that waterfall around a call's body only once
 * every listener and guard allowed it, and `next()` answers the registry's result - for a `web_fetch` that ran,
 * `{ isError: false, value, content, meta }`, its `meta` the tool's `presentationMeta`, `{ url, statusCode, truncated }`
 * (dsh-tools `createSuccessResult`, dsh-tool-web `fetchMetaFromValue`). For a reader's `web_fetch` whose meta reads
 * (`fetchMetaFromResult`) as a status of 200 to 299, `onPage` is told the URL as asked and, when it differs, the URL that
 * answered: the pages that actually opened, which src/boot.ts hands to the `analogViews` service's `notePage`, so an
 * event view can be checked against what a reader read. A fetch that threw or answered another status notes nothing;
 * the result is handed on untouched, and an `onPage` that throws is one line, never the call's failure.
 *
 * THE REACH of a fetch is dsh's http provider's, not this module's: public addresses only when no proxy is set, no
 * credentials in a URL, same-origin redirects only; dsh's own 30 s and 200,000 characters bound each page.
 * @module
 */
import { fetchMetaFromResult } from "@deepseek-ai/dsh-tool-web";
import {
  deskSecretDecision, deskSecrets, equipAgents, webFetchLayer,
  type DeskGuardCtxLike, type DeskGuardExecution, type DeskGuardToolsLike,
} from "./desk-tools.ts";

/** Diagnostic label, the same string every other `${BIN}:`-prefixed line in this program uses. */
const BIN = "gravit-face";
/** The prefix of every line this module writes. */
const SAID = `${BIN}: source reader:`;

/** The role's id under `roles/`. */
export const SOURCE_READER_ROLE = "source-reader";
/** The preset each of the role's children runs on (src/roles.ts `rolePresetDefinition`). */
export const SOURCE_READER_PRESET = "role-source-reader";
/** The tool Gravit and a task's worker call to brief a reader (plugins/role.mjs). */
export const SOURCE_READER_TOOL = "role_source_reader";
/** The most pages one reader opens: one `role_source_reader` call, one child. */
export const SOURCE_READER_PAGES = 40;

/** The tool whose pages are budgeted and noted. */
const FETCH = "web_fetch";

/** The guard's words. */
const READER_SECRET = "the source reader never sends a secret; nothing was sent";
const OVER_BUDGET = `the source reader opens at most ${SOURCE_READER_PAGES} pages a call; report what you have and mark the rest UNVERIFIED`;
const BRIEF_SECRET = "the brief to the source reader carries a secret of the face's environment; nothing was sent";
const UNCHECKED = "the face could not check this call; nothing was sent";

/** What {@link installSourceReader} takes: `log`, where a line is written (default `console.error`), and `env`, the
 * environment the secrets are taken from, once (default `process.env`) - both for tests; and `onPage`, told each page
 * a reader opened. */
export interface SourceReaderOptions {
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  onPage?: (url: string) => void;
}

/** A thrown value as a line shows it; it cannot throw. */
function shown(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "an error that cannot be shown";
  }
}

/**
 * Install the source reader's `web_fetch` and its three fences on the booted ROOT context: the equip
 * (`equipAgents`), the guard and the record, as the module's header says.
 * @param ctx - the booted ROOT context.
 * @param options - see {@link SourceReaderOptions}.
 * @returns the disposer. It removes the record and the equip listener, then disposes the guard's fiber, which
 *   withdraws the guard, and settles once it has. Each step is guarded on its own: one that fails is one line, the
 *   others run regardless, and the disposer never rejects.
 */
export function installSourceReader(ctx: DeskGuardCtxLike, options: SourceReaderOptions = {}): () => Promise<void> {
  const log = options.log ?? ((line: string) => console.error(line));
  const secrets: readonly string[] = deskSecrets(options.env ?? process.env);
  const onPage = options.onPage;
  /** The calls already given a line: the guard can be asked about one call more than once. */
  const told = new WeakSet<object>();
  const tell = (exec: unknown, line: string): void => {
    if (typeof exec === "object" && exec !== null) {
      if (told.has(exec)) return;
      told.add(exec);
    }
    try {
      log(line);
    } catch {
      /* the decision stands without its line */
    }
  };
  /** The pages each reader agent was allowed, by agent; an agent gone is a count gone. */
  const pages = new WeakMap<object, number>();
  /** The `web_fetch` calls already counted, so a call the guard is asked about again is not counted again. */
  const counted = new WeakSet<object>();

  /** Whether `agent` is a reader: its composed preset, else its session's word; the session's word alone when the
   * registry throws, with one line. Throws when neither can be read. */
  const isReader = (exec: DeskGuardExecution, agent: NonNullable<DeskGuardExecution["agent"]>): boolean => {
    let composed: string | undefined;
    try {
      composed = ctx.agentPresets.composedPreset(agent.ctx);
    } catch (error) {
      const word = agent.session.header.agentPreset;
      tell(exec, `${SAID} could not read agent ${String(agent.id)}'s preset (${shown(error)}); its session was created as ${String(word)}`);
      return word === SOURCE_READER_PRESET;
    }
    return composed === SOURCE_READER_PRESET || agent.session.header.agentPreset === SOURCE_READER_PRESET;
  };

  /** The guard's denial for `exec`, or `undefined` to let it go. Never throws. */
  const judge = (exec: DeskGuardExecution): string | undefined => {
    try {
      const name = exec.name;
      const fetch = name === FETCH;
      const brief = name === SOURCE_READER_TOOL;
      /* the secrets, looked for first: a call no fence could deny never costs a registry read */
      let carries: boolean | undefined;
      let unreadable: unknown;
      try {
        if (secrets.length > 0) JSON.stringify(exec.arguments);
        carries = deskSecretDecision(exec.arguments, secrets) !== null;
      } catch (error) {
        unreadable = error;
      }
      if (carries === false && !fetch && !brief) return undefined;
      const agent = exec.agent;
      const reader = agent !== undefined && isReader(exec, agent);
      if (carries === undefined) {
        if (reader || brief) throw unreadable;
        return undefined;
      }
      if (carries) return reader ? READER_SECRET : brief ? BRIEF_SECRET : undefined;
      if (!fetch || !reader) return undefined;
      if (counted.has(exec)) return undefined;
      const spent = pages.get(agent) ?? 0;
      if (spent >= SOURCE_READER_PAGES) return OVER_BUDGET;
      pages.set(agent, spent + 1);
      counted.add(exec);
      return undefined;
    } catch (error) {
      tell(exec, `${SAID} could not judge a ${String(exec?.name)} call from agent ${String(exec?.agent?.id)}, and denied it: ${shown(error)}`);
      return UNCHECKED;
    }
  };

  /** The URL a reader's `web_fetch` asked for, when `exec` is one; else `undefined`. Never throws. */
  const askedBy = (exec: DeskGuardExecution): string | undefined => {
    try {
      if (exec.name !== FETCH || exec.agent === undefined || !isReader(exec, exec.agent)) return undefined;
      const url: unknown = (exec.arguments as { url?: unknown } | null | undefined)?.url;
      return typeof url === "string" ? url : "";
    } catch (error) {
      tell(exec, `${SAID} could not tell whether a web_fetch from agent ${String(exec?.agent?.id)} was a reader's, and noted nothing: ${shown(error)}`);
      return undefined;
    }
  };
  const note = (url: string): void => {
    try {
      onPage?.(url);
    } catch (error) {
      tell(undefined, `${SAID} the page ${url} was not noted: ${shown(error)}`);
    }
  };

  const unequip = equipAgents(ctx, SOURCE_READER_PRESET, (agent) => {
    agent.ctx.inject(["web"], webFetchLayer as (layer: never) => void);
  }, (agent, error) => {
    tell(undefined, agent === undefined
      ? `${SAID} web_fetch could not reach the agents already live: ${shown(error)}`
      : `${SAID} web_fetch was not registered for agent ${agent.id}: ${shown(error)}`);
  });

  const offRecord = onPage === undefined ? undefined : ctx.on("tools/execute", async (exec, next) => {
    const asked = askedBy(exec);
    /* a body that threw rejects here, and reaches the caller as it would have */
    const result = await next();
    if (asked === undefined) return result;
    try {
      const meta = fetchMetaFromResult((result as { meta?: unknown } | null | undefined)?.meta);
      if (meta !== undefined && meta.statusCode >= 200 && meta.statusCode <= 299) {
        if (asked !== "") note(asked);
        if (meta.url !== asked) note(meta.url);
      }
    } catch (error) {
      tell(undefined, `${SAID} a page a reader opened could not be read from its result: ${shown(error)}`);
    }
    return result;
  });

  const guard = ctx.inject(["tools"], function sourceReaderGuard(injected) {
    const tools = injected.get("tools") as DeskGuardToolsLike | undefined;
    if (tools === undefined) throw new Error(`${SAID} the tools service vanished before the guard armed`);
    tools.guard(judge);
  });

  return async () => {
    try {
      offRecord?.();
    } catch (error) {
      tell(undefined, `${SAID} the page record could not be removed: ${shown(error)}`);
    }
    try {
      unequip();
    } catch (error) {
      tell(undefined, `${SAID} the web_fetch listener could not be removed: ${shown(error)}`);
    }
    try {
      await guard.dispose();
    } catch (error) {
      tell(undefined, `${SAID} the guard could not be withdrawn: ${shown(error)}`);
    }
  };
}
