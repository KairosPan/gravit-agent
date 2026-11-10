/** The face's owner device under Node, for the smokes that sign through the face (`account-graft-smoke`): the client's
 * own `host/owner.js` — nothing of its pairing or signing redone here — with the browser's environment handed in as
 * Node has it: the client's real store (its reducers, its empty state), `globalThis.crypto.subtle` (Node 22's
 * WebCrypto), the in-memory key store (`memoryKeys()`, the key never leaves this process), a sign-out flag held in
 * memory, and `post` over Node's `fetch` to the face's own origin. Node's `fetch` sends no `Origin` and no
 * `Sec-Fetch-Site`, and its `Host` is the loopback origin it is given, so the face's fence takes it as it takes the
 * seat smoke's reads. Everything goes to the face's port; nothing here talks to the Account. */
import { createStore } from "../../client/js/store.js";
import { reducers } from "../../client/js/reducers/index.js";
import { emptyState } from "../../client/js/data/empty.js";
import { postVia, startOwner } from "../../client/js/host/owner.js";
import { memoryKeys } from "../../client/js/wire/key-store.js";

/** An answer as `host/owner.js` hands it back: the face's status and the body it passed through. */
export interface OwnerAnswer { status: number; body: Record<string, unknown> }
/** The unsigned door's answer, as `host/act.js` postAct hands it back: taken with the Account's body, or its sentence. */
export type UnsignedAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; said: string };
/** The owner slice of the client's state: this device's standing at the Account. */
export interface OwnerStanding { role: string; kid: string; refusal: string | null; busy: boolean }
/** The device's calls, as `startOwner` returns them. */
export interface OwnerCalls {
  ready(code?: string): Promise<void>;
  /** Get a code: the pair route with `ask`, so the Account prints a code of this browser's own. */
  askCode(): Promise<void>;
  standing(page: unknown): Promise<void>;
  prepare(draft: Record<string, unknown>): Promise<OwnerAnswer>;
  submit(prepared: unknown): Promise<OwnerAnswer>;
  act(draft: Record<string, unknown>): Promise<OwnerAnswer>;
  /** An act the Account takes unsigned, posted once to its unsigned door (`host/act.js`). */
  unsigned(action: Record<string, unknown>): Promise<UnsignedAnswer>;
  signOut(): Promise<OwnerAnswer>;
  signIn(): Promise<void>;
  close(): void;
}
/** The client's store the device stands in, as `createStore` returns it: what the client's other hosts (the sheet engine, the
 * Account host, Sell many) are started over, so they read the same owner standing the device writes. */
export interface ClientStore { get(): Record<string, unknown>; dispatch(type: string, payload?: unknown): void }
/** A started device: its calls, its standing as the store holds it, its store, the signatures it sent, and `close`. */
export interface OwnerNode { owner: OwnerCalls; store: ClientStore; standing: () => OwnerStanding; signatures: () => string[]; close: () => void }

/** The owner device paired through the face at `faceOrigin` (`http://127.0.0.1:<port>`), labelled `label`. Every
 * `signature.es256` value it posts is kept, in this process only, for a smoke to look for in the face's output. */
export function startOwnerNode(faceOrigin: string, label = "Gravit face smoke"): OwnerNode {
  const store = createStore({ initial: emptyState(), reducers });
  let signedOut = false;
  const flag = { get: (): boolean => signedOut, set: (on: boolean): void => { signedOut = Boolean(on); } };
  const sent: string[] = [];
  const toFace = postVia(((path: string, init?: RequestInit) => fetch(`${faceOrigin}${path}`, init)) as typeof fetch);
  const post = (path: string, body?: { signature?: { es256?: unknown } }): Promise<OwnerAnswer> => {
    const es256 = body?.signature?.es256;
    if (typeof es256 === "string") sent.push(es256);
    return toFace(path, body);
  };
  const owner = startOwner({ store, post, subtle: globalThis.crypto.subtle, keys: memoryKeys(), flag, label }) as OwnerCalls;
  return {
    owner,
    store: store as ClientStore,
    standing: () => (store.get() as { owner: OwnerStanding }).owner,
    signatures: () => [...sent],
    close: () => owner.close(),
  };
}
