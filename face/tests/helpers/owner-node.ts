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
/** The owner slice of the client's state: this device's standing at the Account. */
export interface OwnerStanding { role: string; kid: string; refusal: string | null; busy: boolean }
/** The device's calls, as `startOwner` returns them. */
export interface OwnerCalls {
  ready(code?: string): Promise<void>;
  standing(page: unknown): Promise<void>;
  prepare(draft: Record<string, unknown>): Promise<OwnerAnswer>;
  submit(prepared: unknown): Promise<OwnerAnswer>;
  act(draft: Record<string, unknown>): Promise<OwnerAnswer>;
  signOut(): Promise<OwnerAnswer>;
  signIn(): Promise<void>;
  close(): void;
}
/** A started device: its calls, its standing as the store holds it, and `close`. */
export interface OwnerNode { owner: OwnerCalls; standing: () => OwnerStanding; close: () => void }

/** The owner device paired through the face at `faceOrigin` (`http://127.0.0.1:<port>`), labelled `label`. */
export function startOwnerNode(faceOrigin: string, label = "Gravit face smoke"): OwnerNode {
  const store = createStore({ initial: emptyState(), reducers });
  let signedOut = false;
  const flag = { get: (): boolean => signedOut, set: (on: boolean): void => { signedOut = Boolean(on); } };
  const post = postVia(((path: string, init?: RequestInit) => fetch(`${faceOrigin}${path}`, init)) as typeof fetch);
  const owner = startOwner({ store, post, subtle: globalThis.crypto.subtle, keys: memoryKeys(), flag, label }) as OwnerCalls;
  return {
    owner,
    standing: () => (store.get() as { owner: OwnerStanding }).owner,
    close: () => owner.close(),
  };
}
