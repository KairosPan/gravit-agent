# Linqi's Account — the OWNER's signed-action path, byte for byte

Read 2026-10-22 from the install at `/Users/pan/buyer-agent-demo` (buyer-agent-demo, the "Account": Express + TypeScript,
entry `src/portfolio/server.ts`, run as `npm run account` on 127.0.0.1:4820). Read-only: nothing was run or changed.
Every name, field, constant and refusal code below is quoted from the code; anything I inferred rather than read is marked **(inferred)**.
No key material or secret is copied here.

Files this is drawn from: `src/portfolio/public/owner.js` (the device key, 148 lines), `src/portfolio/server.ts` (routes, origin guard),
`src/portfolio/account/{sign,exchange,state,pairing,restore,stream,mode-rules,live-orders,live-moves,live-earn,keystore,brain-keys}.ts`,
`src/portfolio/service.ts` (the `Host` wiring: `widen`, cards, the pairing code), `src/core/{hash,errors}.ts`, `src/portfolio/refuse.ts`,
`src/portfolio/public/ui/{core,shell,agents-mount,trade,money,connect,intent,earn,markets,memory,portfolio,desk,superagent,brains,stream}.js`,
`src/portfolio/mcp.ts`, `test/unit/{account-sign,account-sign-out,server-guard,account-exchange}.test.ts`, `test/standin/ui-standin.ts`.

Vocabulary: the Account calls the signing browser a **device**; its id is `device:<kid>`. An **owner** is an entry of `state.owners`
(`OwnerKey { id, kind: "eoa" | "device", label, jwk?, addedAt }`). "The door" is `POST /api/exchange` → `AccountEngine.exchange()` →
`take()`. "Prepare" is `POST /api/account/prepare` → `AccountEngine.prepare()`.

---

## 0. The HTTP surface the face's Node process has to proxy, and the guard it has to pass

**The origin guard (server.ts, `app.use` before any `/api` route; test/unit/server-guard.test.ts):** every request is refused `403
{ ok: false, error: "this server answers only its own pages on this machine" }` unless ALL of:

- `Host` matches `/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i`;
- there is no `Origin` header, or it equals exactly `` `${req.protocol}://${host}` `` (`req.protocol` is `http`; `Origin: null` is refused);
- `Sec-Fetch-Site` is not `cross-site` or `same-site`, except a top-level navigation (`sec-fetch-mode: navigate` + `sec-fetch-dest: document`
  + GET) to a non-`/api/` path or to `/api/account/signin/callback`.

A browser page at `http://127.0.0.1:3090` fetching `http://127.0.0.1:4820/...` directly sends `Origin: http://127.0.0.1:3090` and
`Sec-Fetch-Site: same-site` → **403 on every route, including `EventSource` to the stream**. So the face's page must talk to the face's
own origin and the face's Node process must forward over loopback, sending `Host: 127.0.0.1:4820`, no `Origin`, no `Sec-Fetch-Site`
(Node's `fetch`/undici adds `sec-fetch-mode` but not `sec-fetch-site` — the guard does not read `sec-fetch-mode` except on the stream
route, where only `navigate`/`document` is refused) **(inferred from the guard's code + the test's comment "fetch puts its own
sec-fetch-mode on every request")**. Two routes additionally want a browser-looking header: `POST /api/account/brain-test` requires
`sec-fetch-site: same-origin` or any `Origin` (an `Origin: http://127.0.0.1:4820` passes the guard and that check).

Bodies: `express.json({ inflate: false })` on every route except `/api/account/brain-key` (which reads its own body, ≤ `BRAIN_KEY_BODY_LIMIT`
= 4096 bytes, content-type exactly `application/json` with optional `charset=utf-8`, no content-encoding). A body the parser cannot read
is answered 4xx `{ ok: false, error: "The body of this request could not be read as JSON; it was not kept." }`. Every `/api/` answer is
`cache-control: no-store`.

Routes the owner path uses (all JSON unless said):

| Route | Signed? | Notes |
|---|---|---|
| `GET /api/now` | no | `{ ok: true, now: <ISO>, ms: <number> }` — the service clock (an agent seat takes its nonce here; the owner's page takes it from prepare) |
| `GET /api/account` | no | the page (`AccountPage` + `mode`, `live`, `dial`, `health`, `memoryAsks`, `agentSetup`, and on a real account `realPage()`: `destinations` dropped, per-venue `runways/agentKey/in/out/swaps/fiat/ledgers` dropped, `DOOR_LISTS` = `dollars`, `networks`, `bridgeChains` added). Carries `signers`, `cards`, `keys`, `spend`, `requests`, `asks`, `intents`, `watch`, `modeRules`, `real: true` |
| `POST /api/account/pair` | no | `{ jwk, label?, code? }` → `{ ok: true, kid, role }` (section 1) |
| `POST /api/account/prepare` | no | `{ draft: { type, ... } }` → `Prepared` or `409 { ok: false, refusal }`; `400 { ok: false, error: "need {draft: {type, ...}}" }` |
| `POST /api/exchange` | **yes** | `{ action, nonce, signature, cosignatures? }` → 200 / 202 / 401 / 409 (section 2) |
| `POST /api/account/brain-key` | yes, special | `{ envelope, apiKey }` — the only route that takes an envelope beside something unsigned (section 3.22) |
| `POST /api/account/wallet/challenge` · `/wallet/prove` | no | EIP-4361 proof of a wallet address (section 3.13) |
| `POST /api/account/signin/start` · `GET /signin/status?state=` · `GET /signin/callback` | no | a venue's OAuth sign-in (Robinhood) |
| `POST /api/account/bridge-routes` `{ draft }` | no | the routes a bridge could take (money.js) |
| `POST /api/account/live/order-sent` `{ order, hash }` · `/live/order-requote` `{ order }` · `/live/sent` `{ payment, hash }` | no | a browser wallet reporting the tx it sent for a DEX order / a movement |
| `GET /api/account/stream[?since=&client=&markets=]` · `POST /api/account/stream/markets` | no | the SSE push channel (section 4.1) |
| `POST /api/mode { mode: "guard" }` · `POST /api/revoke { account }` | no | tightening is unsigned; `mode: "open"` → `401 E_ACCOUNT_OWNER_SURFACE` "opening the dial is the owner's: it arrives as a signed action at POST /api/exchange" |
| `POST /api/say` · `/api/approve` · `/api/restore` · `/api/reset` | — | with the account layer mounted all four answer `401 { ok: false, refusal: E_ACCOUNT_OWNER_SURFACE }`; their signed forms are `setPolicy say` / `approveCard` / `setPolicy restore` / (`setPolicy reset`, refused on a real account) |
| `GET /api/account/{statement,markets,market,compare,positions,funding,explore,holdings,history,receive,asset,quotes,sellable,agents,desk,desk/catalog,desk/feed,desk/seat,memory,memory/agent,candles,book,trades,earn,venues,connect/reach,exchanges,paper/books,keyfile}` | no | reads |

---

## 1. The device key and pairing

### 1.1 The key (owner.js)

- `crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])` — **not extractable**; the server only
  ever gets the public half.
- Storage: IndexedDB database `"buyer-agent-owner"`, version `1`, one object store `"keys"`, the `CryptoKeyPair` stored under record key
  `"device"`. `key()` reads it and generates+puts one when absent. IndexedDB is per origin, so a face page at :3090 necessarily has its own key.
- Sign-out flag: `localStorage["buyer-agent-signed-out"] === "1"` (constant `OUT`). A `storage` event on that key reloads the page
  (other tabs follow a sign-out / sign-in).
- Helpers: `b64u(buf)` = standard base64 with `+`→`-`, `/`→`_`, trailing `=` stripped; `sortKeys`/`canonical` (see 2.1).
- Module state: `role` ∈ `"unknown" | "owner" | "pending" | "needs-code" | "signed-out" | "none"` (`"none"` = the pair call threw, e.g. no WebCrypto), `kid` (string, `""` until paired).

### 1.2 The JWK sent, the pair call

`Owner.ready(code?)`:
1. If signed out and no code given → `{ role: "signed-out" }`, nothing is made or sent. A code given clears the flag.
2. `exportKey("jwk", publicKey)` → sends only `{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }` (i.e. `{ kty: "EC", crv: "P-256", x, y }`,
   `x`/`y` base64url of 32 bytes each — the server's `isJwk` checks `kty === "EC"`, `crv === "P-256"`, and that `x` and `y` decode to exactly 32 bytes).
3. `POST /api/account/pair` body: `{ jwk: {kty,crv,x,y}, label: "this browser", ...(code ? { code } : {}) }`.
   Server: `label` must be a non-empty string, trimmed, cut to 40 chars (else `"this browser"`); `code` cut to 20 chars.
4. Answer `200 { ok: true, kid: <16 hex>, role: "owner" | "pending" | "needs-code" }` → `role`, `kid` kept. Any non-200 → `{ role, refusal: <why(r)> }`
   where `why` = `body.refusal.message || body.error || body.result.message || ""`.
   Refusals (all `400 { ok: false, refusal }`): `E_ACCOUNT_BAD_ACTION` "a device key is a P-256 public key (JWK)"; `E_ACCOUNT_OWNER_SURFACE`
   "that is not the pairing code this server printed in its terminal (N tries left)"; `E_ACCOUNT_OWNER_SURFACE` "too many wrong pairing codes:
   restart the server for a new one" (after 5 misses, `codeMisses`); `E_ACCOUNT_OWNER_SURFACE` "10 devices are waiting already: the owner lets
   one in from a device that signs, or the server is restarted" (`MAX_PENDING_DEVICES = 10`). `404 { ok: false, error: "the account layer is not mounted" }` under `--classic`.

**kid** (`sign.ts kidOf`): `sha256(base64url-decode(x) ‖ base64url-decode(y))` hex, first 16 characters (8 bytes). The device's signer id
everywhere (owners list, nonce book, ledger `signer`, `signOut.device`) is the string `` `device:${kid}` ``. The page never computes the kid;
it takes `r.body.kid`. The face may compute it or take it from the answer (both are the same value).

### 1.3 The first-device rule (`exchange.ts pairDevice`)

```
if isOwner(state, "device:"+kid)            → { ok, kid, role: "owner" }       (idempotent re-pair)
if owners.length === 0 && host.pairingCode() !== undefined:
    code undefined or ""                   → { ok, kid, role: "needs-code" }
    codeMisses >= 5                        → E_ACCOUNT_OWNER_SURFACE (restart)
    plain(code) !== plain(expected)        → codeMisses++, E_ACCOUNT_OWNER_SURFACE (N tries left)   plain = strip /[^A-Za-z0-9]/g, toUpperCase
if owners.length === 0                     → owners = [{ id, kind: "device", label, jwk: {kty,crv,x,y}, addedAt }]; ledger row
                                              { kind: "action", venue: "*", tool: "account_pair", signer: id, native: { jwk, label, code: true } }
                                             → { ok, kid, role: "owner" }
else (an owner exists)                     → if not already pending: pendingDevices.length >= 10 → refusal; else push { kid, jwk, at, label },
                                              ledger row { tool: "account_pair", signer: id, native: { jwk, label, pending: true } }
                                             → { ok, kid, role: "pending" }
```

- Every non-`--classic` run has a pairing code (server.ts: `const code = classic ? undefined : pairingCode()`), trading on (`liveWrites`)
  or `--read-only` alike. It is printed once at start under the `TRADING IS ON …` / `read-only: …` line as `  pairing code: XXXX-XXXX — the
  first browser becomes the owner only with this code, typed on the page` — only when the restored account has no owner (`owned` false).
  Background service: `npm run account:service -- code` reads the last `pairing code:` line of this run's log.
- `pairing.ts pairingCode()`: 8 characters from the alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O/1/I/L), written `XXXX-XXXX`;
  the comparison ignores case and non-alphanumerics (`"k7qx m2pa"` matches `K7QX-M2PA`).
- **The code is only ever checked while `owners.length === 0`.** A second device never needs it, and typing it changes nothing for one.

### 1.4 The second-device procedure (the real service)

1. The face's page makes its key and POSTs `/api/account/pair` → `{ role: "pending", kid }`. The Account records it as a pending device
   (label kept), writes the `account_pair … pending: true` row, and pushes an SSE `card` event `{ waits: "device", venue: "*", at }`.
   `GET /api/account` then lists it under `signers.pendingDevices: [{ kid, at }]` (no label on the page's read).
2. **An existing owner must admit it**: the Account page, Settings › Devices, row "A browser asked to sign · <kid>" → button "Let it sign"
   (agents-mount.js `renderDevices`) runs one owner action:
   `{ type: "convertToMultiSigUser", signers: JSON.stringify({ authorizedUsers: [...A.signers.owners.map(o => o.id), "device:<kid>"].sort(), threshold: A.signers.threshold }) }`
   → prepare → sign with the admitting device's key → `/api/exchange`.
   `state.ts applyOwner convertToMultiSigUser`: `signers` must parse as `{ authorizedUsers, threshold }`; 1–10 users (`MAX_SIGNERS = 10`),
   **sorted, no repeats** ("authorizedUsers is a sorted list without repeats"), `threshold` an integer in `[1, users.length]`; each id is an
   existing owner id, a pending device id (`device:<kid>` — it becomes `{ kind: "device", label: <its pairing label or "device">, jwk }`),
   or a lower-case `0x` address (`{ kind: "eoa", label: "co-signer" }`); anything else → `E_ACCOUNT_BAD_ACTION` "\"<id>\" is not a signer
   this account knows: a device is paired first, an address is lower-case". The owners list is REPLACED by the list given (an owner left
   out is dropped), and the admitted devices leave `pendingDevices`.
3. The face's next `/api/account/pair` (or any later one) answers `{ role: "owner" }`. The Account page does this itself on each read
   (`core.js load()`: if `Owner.role === "pending"` and its kid is now in `signers.owners` → `Owner.ready()`); and if the service restarted
   and its kid is neither owner nor pending → `Owner.ready()` again (re-pair).
4. The admitted device signs alone: the page sends one signature per action and keeps `threshold` at 1 ("Every device signs alone … one
   signature is enough. Requiring two signatures on each action waits for a way to give the second one."). A threshold above 1 would make
   every owner action need `cosignatures` (section 2.6).

Alternative first-owner order **(inferred, from the same rules)**: if the Account has no owner (fresh home, or after the last sign-out),
the face can pair FIRST with the printed code and become the owner; the operator's own browser would then be the pending device, which
only the face could admit — the face would need its own "Let it sign" (a `convertToMultiSigUser` with the kid read from
`signers.pendingDevices`).

**The stand-in differs** (`test/standin/ui-standin.ts`): it wraps `pairDevice` so that ANY browser that types the code is made a co-owner
automatically (the stand-in's seed key signs `convertToMultiSigUser { authorizedUsers: ["device:<kid>", "device:<seed kid>"].sort(), threshold: 1 }`),
once per run (`handed`); a browser after that waits as on the real account. On the real service a second device is never let in by the code.

### 1.5 Sign-out and code regeneration

- `Owner.signOut()`: refused locally unless `role === "owner" && kid` (`{ status: 0, body: { ok: false, error: "This browser does not sign for the account." } }`);
  else `act({ type: "signOut", device: "device:<kid>" })` (prepare → sign → exchange). On `200` with `ok !== false`: sets the flag, `role = "signed-out"`,
  `kid = ""`, deletes the IndexedDB record `"device"`. A refusal or no answer leaves the key and role as they were.
- Door rules: `signOut.device` must equal the signer (`E_ACCOUNT_BAD_ACTION` "a browser signs only itself out: this sign-out names another device");
  `|now − nonce| ≤ SIGN_OUT_TTL_MS` (10 min) else `E_ACCOUNT_EXPIRED`; prepare refuses a device that is not an owner device
  ("this browser does not sign for the account: there is nothing to sign out of"). `applyOwner signOut`: the device leaves `owners`,
  `threshold = max(1, min(threshold, owners.length))`.
- Last device out (`owners.length === 0`): `codeMisses = 0`, `host.ownerGone()` → `service.ts newPairingCode()` makes a NEW code and prints
  `signed out: no browser signs for the account now\n  pairing code: XXXX-XXXX — the next browser becomes the owner only with this code …`.
  The old code is then a wrong try. Summary: `signed out: device <8 hex> no longer signs for the account · no browser signs for it now: the next one pairs with a new pairing code`.
- An EOA owner cannot sign out (prepare: "this browser does not sign for the account…"); owners are changed by `convertToMultiSigUser`.
- `Owner.signIn()`: clears the flag and calls `ready()` — a new key is generated (the old one was deleted), then the code (no owner) or a wait (pending).

### 1.6 Restart (`restore.ts rebuild`)

- The first owner comes back from its `account_pair` row (`native.jwk`, `label`); a run that requires a code skips an owner whose row lacks
  `code: true` ("paired without a pairing code: it pairs again with the code this run printed") — only possible from a `--classic`-era row.
- Pending rows (`native.pending: true`) are kept in an `asked` map, NOT as pending devices; a later `convertToMultiSigUser` row that names
  such a device re-admits it with that JWK. So an admitted second device survives restarts as an owner; a device that was only pending has to pair again.
- Every signed owner row is verified against the owners as they stood then (`signerOf` + `threshold`), replayed in order (`STANDING` =
  approveAgent, approveSpend, setDestination, convertToMultiSigUser, signOut, createSubAccount, setWatch, setIntent); a `signOut` row naming
  another device is skipped. All nonces in the ledgers are remembered (`rememberNonces`), so no old envelope replays into a fresh process.

### 1.7 What identifies a device afterwards

`` `device:${kid}` `` — the owner id, the nonce-book key, the ledger `signer`, the `signOut.device` value, and the lookup key for
verification: `signerOf()` takes `deviceKeys(state)` (a `Map<kid, Jwk>` of the owners of kind `device`), reads `sig.kid`, verifies ES256
against that JWK over the device signing input, and returns `device:<kid>` or `null`. A pending (not yet admitted) device is not in that map,
so its signatures fail as `E_ACCOUNT_BAD_SIGNATURE` (not as "unknown signer").

---

## 2. The envelope

### 2.1 The bytes that are signed (owner.js `sign` ≡ sign.ts `deviceSigningInput`)

```
message = { accountChain: prepared.accountChain }           // then, for each f of prepared.shown: message[f.name] = f.value
input   = canonical({ domain: prepared.domain, primaryType: prepared.primaryType, message })
sig     = ECDSA(P-256, SHA-256) over new TextEncoder().encode(input)      // WebCrypto: raw r‖s, 64 bytes
signature = { kid, es256: b64u(sig) }
```

`canonical(v)` (core/hash.ts, copied verbatim in owner.js): `JSON.stringify(sortKeys(v))` where `sortKeys` sorts object keys recursively
(arrays keep order), **drops keys whose value is `undefined`**, no whitespace. Hence the field order of `shown` never matters: the bytes are
the alphabetical form. Every value in `message` is a **string** (`shown[].value` is `String(...)` of the typed-data message; uint64 fields
are decimal strings, e.g. `"1761100000000"`); `domain.chainId` is a **number**.

- `prepared.domain` = `{ name: "AgentAccountSignTransaction", version: "1", chainId: 424242 }` (`ACCOUNT_DOMAIN`; its `verifyingContract` 0x00…00 is NOT in the device input).
- `prepared.accountChain` = `"Simulation"` (`ACCOUNT_CHAIN`) for every type except the live ones, which sign `"Live · real money"` (`LIVE_CHAIN`;
  `LIVE_TYPES` = liveMove, liveOrder, liveCancel, liveAmend, liveClose, liveLeverage, liveEarn).
- `prepared.primaryType` per type (section 3 table); `prepared.shown` = the type's fields in signing order, `accountChain` excluded, as `{ name, value: string }`.

Illustrative bytes (a watch; the nonce is any service-clock ms):

```
{"domain":{"chainId":424242,"name":"AgentAccountSignTransaction","version":"1"},"message":{"accountChain":"Simulation","nonce":"1761100000000","on":"true","symbol":"BTC/USDT","venue":"okx"},"primaryType":"AccountTransaction:SetWatch"}
```

Server verification (`es256Verify`): `createPublicKey({ key: { kty, crv, x, y }, format: "jwk" })`, `verify("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(es256, "base64url"))`.
Test fixture: `deviceSigningInput(send())` contains `"primaryType":"AccountTransaction:SendAsset"` and `"amount":"500"`; the raw signature is 64 bytes.

The server never signs from `shown`: it rebuilds the typed data from `envelope.action` (`ownerTypedData(action)`: `accountChain` first, then the
type's fields; uint64 → `BigInt(Math.trunc(Number(v)))`, bool → `Boolean`, else `String(v ?? "")`) and converts bigints to decimal strings. So the
action the envelope carries must reproduce exactly the strings that were shown (numbers: safe integers; strings: as prepared).

### 2.2 The action's id

`actionHash(action)` = viem `hashTypedData` of the EIP-712 typed data (domain incl. `verifyingContract`, `types: { [primaryType]: [accountChain, ...fields] }`).
It is the ledger's reference, the idempotency key (`owner:<hash>`, section 2.5), and what an `approveCard` names for a card the older write path raised.

### 2.3 The nonce

- `action.nonce` and `envelope.nonce` are the same number (`malformed`: a safe integer ≥ 0, "the nonce is a whole number of milliseconds";
  the door: `envelope.nonce !== action.nonce` → `E_ACCOUNT_BAD_ACTION` "the envelope's nonce is the action's nonce").
- Prepare assigns it: `nextNonce()` = `max(now, min(lastNonce + 1, now + 1000))` on the SERVICE clock (`host.now()`); the page signs
  exactly what prepare returned (`prepared.action.nonce`, also shown as the `nonce` field). An agent seat uses `GET /api/now`.ms instead.
- `NonceBook.check(signer, nonce, now)` per signer id: `"too-old"` unless `nonce > now − 2 days`; `"too-new"` unless `nonce < now + 1 day`;
  `"used"` if among the signer's kept nonces or remembered from the ledgers; `"below-floor"` if 100 are kept and `nonce <= smallest kept`
  (`KEPT = 100`); else `"ok"`. Refusal: `E_ACCOUNT_NONCE` with `message` one of "this nonce was used before" / "this nonce is below the signer's
  floor" / "this nonce is more than two days old" / "this nonce is more than a day ahead" and `detail: { nonce, verdict }`. Checked for EVERY
  signer on the envelope (cosigners too), spent (`use`) only after all other checks pass. A signer's book is never dropped.
- Extra time bounds, all `E_ACCOUNT_EXPIRED` with `detail.signedAt`: `MONEY_TYPES` (sendAsset, swap, approveCard, liveMove, liveOrder, liveAmend,
  liveClose, liveLeverage, liveEarn + the agent twins) `|now − nonce| ≤ MONEY_TTL_MS` (10 min, both directions: "signed N min ago: a money
  instruction is good for 10 minutes" / "dated N min ahead…"); `PAPER_TYPES` (resetPaper, topUpPaper) 10 min; `signOut` 10 min; `setBrainKey` 10 min.
- Independently, the actions that carry a `deadline` field (liveOrder, liveAmend, liveMove, liveEarn, sendAsset) are refused by their door when
  `realNow() > deadline` (`E_ACCOUNT_EXPIRED` "this order was good for ten minutes after it was prepared: prepare it again" and siblings);
  prepare sets `deadline = realNow() + TTL_MS` (10 min; `realNow` = `liveMoney().realNow()`, the real clock; the nonce is the service clock — the
  same wall clock on a real server **(inferred)**).

### 2.4 The request body of `POST /api/exchange`

```json
{ "action": { "type": "<owner type>", ...fields, "nonce": 1761100000000 },
  "nonce": 1761100000000,
  "signature": { "kid": "<16 hex>", "es256": "<base64url, 86 chars>" },
  "cosignatures": [ { "kid": "...", "es256": "..." } | { "r": "0x…", "s": "0x…", "v": 27 } ]   // optional
}
```

The door reduces it first thing to those four fields (`ownEnvelope`): a signature keeps only `{ kid?, es256 }` (or `{ r?, s?, v? }`), anything
else beside them is dropped; a field INSIDE the action that its type does not sign is refused (`malformed`: `"<name>" is not part of what
"<type>" signs` — the name is quoted only when it is a plain identifier, else "a field it was sent"); a uint64 field must be a safe integer ≥ 0
(`"<name>" is a whole number, zero or more`), every other field a string (`"<name>" is text`).

### 2.5 The checks, in order (`exchange.ts take`)

1. `action.type` known (`OWNER_TYPES` ∪ `AGENT_TYPES`) else `E_ACCOUNT_BAD_ACTION` "not an instruction this account knows".
2. `malformed(action)`; `envelope.nonce === action.nonce`.
3. `setBrainKey` / `setDesk` key-shaped-text checks (`E_ACCOUNT_BAD_ACTION`, fixed words).
4. `signerOf(action, signature, deviceKeys(state))` → `device:<kid>` or an address; `null` → `E_ACCOUNT_BAD_SIGNATURE { detail: { type } }`.
5. Owner action: signer must be an owner, else `E_ACCOUNT_UNKNOWN_SIGNER { detail: { signer } }` (a key the account never saw) or
   `E_ACCOUNT_OWNER_ONLY` (an agent key). Cosignatures that verify as other owners join the signer set. A device signature on an agent action →
   `E_ACCOUNT_BAD_ACTION` "a device key signs owner actions".
6. Replay: key `owner:<actionHash>` (owner actions — the same whoever of the owners signed) or `<signer>:<hash>` (agent). An answer kept in
   the last `RESULTS_KEPT_MS` (2 days) is returned again as-is (the same HTTP status, nothing runs twice); a hash taken by an earlier run →
   `E_ACCOUNT_NONCE` "an earlier run of this account already took this instruction: it is not taken twice" (`detail.verdict: "used"`).
7. `signers.size < state.threshold` → `E_ACCOUNT_THRESHOLD` "this account needs N signers; M signed".
8. Nonce verdicts for every signer; the time bounds of 2.3; `signOut` names the signer.
9. Nonces spent; a `taken` ledger row written (`outcome: "taken"`); then `settle()` and `run()`.
10. The outcome is kept under the replay key; refusals also get an `account-refusal` ledger row.

Instructions are taken **one at a time** in arrival order (`serially`): the page may fire several (`tkCancelAll` does), they queue.

### 2.6 The response of `POST /api/exchange`

Status: `200` for every `ok: true` outcome except `202` for `kind: "card"`; `401` for `SIGNER_CODES` = `E_ACCOUNT_BAD_SIGNATURE`,
`E_ACCOUNT_UNKNOWN_SIGNER`, `E_ACCOUNT_AGENT_EXPIRED`, `E_ACCOUNT_AGENT_REVOKED`; `409` for every other refusal; `403` the guard; `500 { ok: false,
error: "The account hit an error answering this; it was recorded." }` for a thrown non-refusal. Body:

```
{ ok: true, kind: "account", summary }                                   // settings, connections, sign-out, steering
{ ok: true, kind: "order",   order: LiveOrder, flight? }                 // liveOrder, liveCancel, liveAmend, (a close)
{ ok: true, kind: "payment", payment: Payment, flight?, data? }         // liveMove (and a close/earn in some paths)
{ ok: true, kind: "result",  result: unknown, flight? }                  // setPolicy with data, liveLeverage, a wallet-sent move
                                                                         //   ({ result: { wallet, payment, walletTxs } }), memory notes,
                                                                         //   AND a rejected card: result is itself a refusal object
{ ok: true, kind: "card",    pending: true, card: CardLike, flight? }    // 202 (an agent's path; the owner never gets one for an owner action)
{ ok: false, refusal: { ok: false, code, layer, message, venue?, tool?, detail?, native? } }
```

The page's "refused" test (`core.js refusedAt`): `!r || r.status >= 400 || !r.body || r.body.ok === false || (r.body.kind === "result" && r.body.result && r.body.result.ok === false)` — the last clause matters for a card rejected and for a wallet-sent move.

### 2.7 Refusal codes the owner path can meet (code → where → meaning)

| Code | Status | Raised by | Meaning |
|---|---|---|---|
| `E_ACCOUNT_BAD_SIGNATURE` | 401 | door | the signature does not verify for this action under the account's device keys / owners (a pending device, a signed-out device, a tampered field); also from `answerCard` (409) "this approval names a different instruction than the one the card holds"; also pair-less `/api/execute` `/api/order` |
| `E_ACCOUNT_UNKNOWN_SIGNER` | 401 | door | an EOA signature recovered to an address that is neither owner nor agent |
| `E_ACCOUNT_OWNER_ONLY` | 409 | door | an agent key signed an owner type |
| `E_ACCOUNT_OWNER_SURFACE` | 400 / 401 | pair · unsigned owner routes | wrong/too many pairing codes, 10 pending devices; `/api/say` `/api/approve` `/api/restore` `/api/reset` `/api/mode open` under the layer |
| `E_ACCOUNT_NONCE` | 409 | door | used / below floor / too old / too new / taken by an earlier run |
| `E_ACCOUNT_EXPIRED` | 409 | door, live doors | 10-minute TTLs (2.3), `deadline` passed |
| `E_ACCOUNT_THRESHOLD` | 409 | door | fewer distinct owner signatures than `threshold` |
| `E_ACCOUNT_BAD_ACTION` | 409 (400 at pair) | everywhere | malformed, unknown type, a rule in words (the bulk of refusals; see each action) |
| `E_ACCOUNT_LIMIT` | 409 | state.ts | a count/duration cap (10 signers, 12 agent keys, 180 days, 20 intents, 50 watches, 10 fee approvals, 10 sub-accounts, 50 destinations) |
| `E_ACCOUNT_REQUOTE` | 409 | live doors | the price/fee/address/market moved past what was signed: prepare again |
| `E_ACCOUNT_CARD_EXPIRED` · `E_CARD_NOT_GRANTED` · `E_CARD_REJECTED` | 409 | approveCard | section 4 |
| `E_ACCOUNT_ORDER_UNKNOWN` | 409 | cancel/amend | no such order at that venue on the account |
| `E_WALLET_LIVE_WRITES_OFF` | 409 | live doors | the server runs `--read-only` (`detail.turnOn`) |
| `E_WALLET_ACCOUNT_UNKNOWN` · `E_VENUE_RAIL_CLOSED` · `E_VENUE_REJECTED` · `E_VENUE_GEOBLOCKED` · `E_VENUE_UNREACHABLE` · `E_VENUE_ORDER_INVALID` · `E_VENUE_INSUFFICIENT` | 409 | live doors | venue-side facts (`detail.beforeSigning: true` when prepare refused on the venue's own rule) |
| `E_ACCOUNT_DESTINATION` · `E_ACCOUNT_DEST_COOLING` · `E_ACCOUNT_SOURCE` · `E_ACCOUNT_UNPRICED` · `E_ACCOUNT_NOT_HOME` | 409 | simulated money paths | not reachable on a real account (those types are refused as `realOnly`) |
| `E_PAYEE_UNSUPPORTED` | 409 | setPolicy close-session, agentPay | no payer mounted |

Default sentences (refuse.ts `EN`) apply when a refusal is raised without `message`, e.g. `E_ACCOUNT_BAD_SIGNATURE` "the signature does not match the instruction".

---

## 3. Per owner action

Common path on the page (`core.js own()` ≡ `Owner.act(draft)`): `POST /api/account/prepare { draft }` → on `200` with `ok !== false` and an
array `shown`, `Owner.submit(prepared)` → `POST /api/exchange { action: prepared.action, nonce: prepared.action.nonce, signature: sign(prepared) }`.
A refusal at prepare is returned as it came (never signed). Sheets built with `quoteDialog` (core.js) re-prepare on every form change
(debounced), show `whatYouSign(prepared)` = `<details class="signs"><summary>What you sign</summary><pre>name: value\n…</pre></details>`, and for
an action with `deadline` show a countdown "Your signature is good for m:ss more." and re-prepare when it reaches 0; a submit whose form
changed since the shown preparation re-prepares instead of signing.

`Prepared` (exchange.ts): `{ ok: true, action: OwnerAction, primaryType, domain: { name, version, chainId }, accountChain, shown: [{ name, value }], quote? }`
with `quote = { words, feeUsd, receiveUsd, lands, access, signAt?, live?: { toAddress, network, capUsd }, order?: OrderQuote, close?: CloseQuote, earn?: EarnQuote, final, legs }`.

**Which actions need no prepare:** on the page, none — every action goes through prepare. Mechanically, `prepare()` has only five quoting
branches (`sendAsset`, `liveMove`, `liveOrder`/`liveAmend`, `liveClose`, `liveEarn`); every other owner type takes the generic branch
`action = { ...draft, type, nonce }`, which only validates (`malformed`, plus the per-type pre-checks listed below) and returns the typed-data
metadata — a consumer that replicates `OWNER_FIELDS` could build those envelopes itself with a nonce from `GET /api/now` **(inferred; the page never does)**.
Prepare has no ledger row and no side effect except advancing `lastNonce`.

On a real account (`host.real`, the default server), `prepare` and the door refuse the simulated-money types outright: `sendAsset`, `swap`,
`createSubAccount` (unless agent wallets are mounted), `userSetAbstraction`, `setDestination`, `approveBuilderFee` (+ agent twins) →
`E_ACCOUNT_BAD_ACTION` "this account holds real accounts only: \"<type>\" acts on simulated venues. Real orders are liveOrder (the owner) and
agentLiveOrder (an agent); real money moves with liveMove and agentLiveMove" (`detail.use`). `approveSpend` with `scope: "payees"` and a budget > 0
is refused the same way unless a real payer is mounted.

The primary types (sign.ts `OWNER_FIELDS`); signed field order = the order listed, then `nonce`:

| type | primaryType | fields (all `string` unless `u64`) |
|---|---|---|
| liveOrder | `AccountTransaction:LiveOrder` | venue, symbol, side, orderType, qty, limitPrice, stopPrice, tif, postOnly, reduceOnly, extendedHours, trailPercent, trailPrice, takeProfit, stopLoss, maxNotional, deadline u64 |
| liveAmend | `AccountTransaction:LiveAmend` | venue, order, qty, limitPrice, stopPrice, maxNotional, deadline u64 |
| liveCancel | `AccountTransaction:LiveCancel` | venue, order |
| liveClose | `AccountTransaction:LiveClose` | venue, symbol, qty |
| liveLeverage | `AccountTransaction:LiveLeverage` | venue, symbol, leverage, marginMode |
| liveMove | `AccountTransaction:LiveMove` | kind, from, fromLedger, to, toLedger, asset, toAsset, network, amount, toAddress, maxFee, deadline u64 |
| liveEarn | `AccountTransaction:LiveEarn` | venue, kind, product, asset, amount, maxUsd, lands, deadline u64 |
| approveAgent | `AccountTransaction:ApproveAgent` | agentAddress (address), agentName, validUntil u64 |
| approveSpend | `AccountTransaction:ApproveSpend` | agent (address), scope, allow, perPayment, budget, windowHours u64, validUntil u64, [intent], [renewHours u64] |
| convertToMultiSigUser | `AccountTransaction:ConvertToMultiSigUser` | signers |
| signOut | `AccountDevice:SignOut` | device |
| approveCard | `AccountApproval:Card` | card, action (bytes32), decision |
| setPolicy | `AccountTransaction:SetPolicy` | change, value |
| connectVenue | `AccountTransaction:ConnectVenue` | venue, connector, label, credentialRef |
| disconnectVenue | `AccountTransaction:DisconnectVenue` | venue |
| resetPaper · topUpPaper | `AccountPaper:Reset` · `AccountPaper:TopUp` | venue, usd |
| answerAsk | `AccountTransaction:AnswerAsk` | ask, decision |
| setIntent | `AccountTransaction:SetIntent` | id, agent, venue, symbol, side, usd, text, validUntil u64 |
| setWatch | `AccountTransaction:SetWatch` | venue, symbol, on |
| setMemory · forgetMemory · setMemoryRules | `AccountMemory:Keep` · `AccountMemory:Forget` · `AccountMemory:Rules` | scope, id, topic, text · scope, what · scope, learn, ask, share |
| setDesk | `AccountDesk:Set` | desk, change, value |
| setBrainKey | `AccountBrain:SetKey` | provider, baseUrl, model, keyHash, salt |
| createSubAccount | `AccountTransaction:CreateSubAccount` | name, agent (address), float |
| sendAsset · swap · approveBuilderFee · userSetAbstraction · setDestination | `AccountTransaction:SendAsset` · `:Swap` · `:ApproveBuilderFee` · `:UserSetAbstraction` · `:SetDestination` | simulated only (refused on a real account) |

`shownFields` renders an `address`/`bytes32` field as the string given (prepare does not lower-case; `applyOwner` lower-cases addresses when
it applies them). The 31 owner types above are the whole `OWNER_TYPES`; agent types are 17 (section 5).

### 3.1 The owner's live order — `liveOrder` (ui/trade.js: the Trade ticket)

Draft (`tkOrderDraft`): `{ type: "liveOrder", venue, symbol, side: "buy"|"sell", orderType: "market"|"limit"|"stop"|"stop_limit"|"trailing_stop", qty | usd (one of the two, as typed), limitPrice (""), stopPrice (""), tif: ""|"gtc"|"ioc"|"fok"|"day", postOnly: "true"|"", reduceOnly: "true"|"", extendedHours: "true"|"", trailPercent, trailPrice, takeProfit, stopLoss }`
— prices for a prediction market typed in cents (`tkPriceIn`). The "Pay with" two-step path first prepares a sale, then a buy
`{ type: "liveOrder", venue, symbol, side: "buy", orderType: "market", usd: "<what the sale brought>", limitPrice: "", stopPrice: "", tif: "", postOnly: "", reduceOnly: "" }` — two signatures.

Prepare (`live-orders.ts prepare`): plans against the venue's market (`plan`), asks the venue's own rule (`placeRule`, `estimateOf`, 1.5 s
budget) and returns the exact action: `qty` always in the market's units (a `usd` draft is converted), every price as `plain(...)` strings,
`maxNotional` = a buy: the most it may cost (`cents(p.maxUsd)`), a sell: what it is worth now, floored to the cent; `deadline = realNow() + 600000`.
`quote.order` (`OrderQuote`): `{ words, name, kind, base, quote, price, notionalUsd, maxUsd, worstPrice?, note?, capUsd, paper?, quoteAt?, quoteFrom?, feeUsd?, feeBps?, liquidationPrice?, leverage?, queued? }`.
A venue that would refuse the order now → `E_VENUE_REJECTED { detail: { beforeSigning: true } }` with the venue's words — nothing to sign.
Read-only server → `E_WALLET_LIVE_WRITES_OFF`.

"What you sign": the 17 fields + `nonce` (the ticket adds notes per field: `tkSignNotes`). The ticket re-prepares quietly after `TK_FRESH_MS`
when the top of book moved, and always when `deadline − now < 30 s` on submit.

Door (`owner`): plans again from the signed fields (`usd` forced `""`), `realNow() > deadline` → `E_ACCOUNT_EXPIRED`; `hold()`: the venue's
symbol must still be the signed one; a buy whose notional now exceeds `maxNotional` → `E_ACCOUNT_REQUOTE` "the price moved: …"; a sell that
would fetch more than 2 % under it (`SLIPPAGE`) → `E_ACCOUNT_REQUOTE` "the price fell: …"; the `--live-cap` (`capUsd`, `setPolicy cap`) binds a
real venue, not a paper one. Answer `{ ok: true, kind: "order", order: { id: "ord-0001", venue, symbol, side, type, qty, status, filledQty, … } }`.

### 3.2 Amend — `liveAmend` (trade.js Open orders › Change)

Draft: `{ type: "liveAmend", venue: o.venue, order: o.id, qty: "<new or ''>", limitPrice: "<new or ''>", stopPrice: "<new or ''>" }` ("" keeps what it was; at least one given).
Prepare (`prepareAmend`): the order must be the owner's and changeable (`changeable`), re-planned (`amendPlan`); returns the draft's five fields +
`maxNotional` (as 3.1) + `deadline = realNow() + 600000`; `quote.order` as 3.1 with `words: "<id>: …"`. Door: `deadline`, `hold()` as 3.1; answer `kind: "order"`.

### 3.3 Cancel — `liveCancel`

Draft: `{ type: "liveCancel", venue, order: "ord-0007" }` — generic branch, no quote, **not a money type** (no 10-min TTL beyond the nonce window);
the page signs it with one click (`cancelOrder`, `tkCancelAll` fires one per order in parallel). Door (`cancel`): `E_ACCOUNT_ORDER_UNKNOWN` if no such
order at that venue; `E_ACCOUNT_BAD_ACTION` "<id> is already <status>" if done; a wallet order not yet sent is taken back locally; answer `kind: "order"`.

### 3.4 Close — `liveClose` (trade.js `openClose`, earn.js Sell many)

Draft: `{ type: "liveClose", venue, symbol, qty: "<part>" | "" }` ("" = all of it). Prepare (`prepareClose`): reads the position (`closing`), the venue's
rule, returns `{ venue, symbol, qty: "" | plain(qty) }` and `quote.close` (`CloseQuote`): `{ words, venue, venueName, symbol, name, side, qty, worstPrice?, price, worthUsd, capUsd, overCap, why?, paper? }`
— `overCap: true` means the door would refuse it as it stands (the sheet's `block` shows `why`). No `deadline` field; it is a `MONEY_TYPES` action (10-min nonce TTL). Answer `kind: "order"` (a market order) **(inferred from `close()` placing through `place`)**.

### 3.5 Leverage — `liveLeverage` (trade.js perps panel)

Draft: `{ type: "liveLeverage", venue, symbol, leverage: "<1..999 digits>", marginMode: "" | "cross" | "isolated" }` — generic branch, no quote; money type (10 min).
Door (`leverage`): the venue must set leverage from the account (`E_VENUE_RAIL_CLOSED`), the market a perp/future, ≤ its `maxLeverage` (`E_VENUE_ORDER_INVALID`);
answer `{ ok: true, kind: "result", result: { leverage, marginMode, … } }` **(result shape inferred from trade.js reading `res.leverage` / `res.marginMode`)**.

### 3.6 A movement — `liveMove` (ui/money.js `openLiveMove`)

Draft: `{ type: "liveMove", kind: "withdraw" | "send" | "transfer" | "swap" | "bridge", from: <venue id>, fromLedger, to: <venue id> (defaults to from), toLedger, asset (default "USDC"), toAsset (default asset), network, amount }`
(money.js asks prepare once per network to list fees: `{ ...d, network: n }` → `action.maxFee`; a bridge asks `POST /api/account/bridge-routes { draft }` first).
Prepare (`live-moves.ts prepare`): plans the move (the destination's deposit address is asked of the destination venue — never taken from the page),
returns the draft's fields + `toAddress` (the venue's address or ""), `maxFee` = the quoted fee rounded UP to the cent as a 2-decimal string, `deadline = realNow() + 600000`;
`quote = { words: "<kind> <amount> <asset>[ for <toAsset>]", feeUsd, receiveUsd, lands: "at once" | "when the venue has sent it", access: "owner", final: true, legs: [], live: { toAddress, network, capUsd } }`.
"What you sign" shows the exact `toAddress`. Door (`owner`): re-plans; `deadline`; `changed()`: a different address now → `E_ACCOUNT_REQUOTE` "… now gives <addr> as the address, not the <addr> that was signed for: nothing was sent"; a fee above `maxFee` → `E_ACCOUNT_REQUOTE`.
Answer `kind: "payment"` (`payment.id` "pay-0001"), or for a wallet source `kind: "result"` with `{ wallet, payment, walletTxs }` — the browser wallet then sends and the page reports `POST /api/account/live/sent { payment, hash }`.

### 3.7 Earn — `liveEarn` (ui/earn.js)

Draft (`enDraft`): `{ type: "liveEarn", venue, kind: "supply" | "withdraw", product: <product id>, asset, amount: "<n>" | "all" }`.
Prepare: returns `{ venue, kind, product, asset, amount: plain(amount), maxUsd: cents(usd).toFixed(2), lands: <venue/product>, deadline: realNow() + 600000 }` and `quote.earn` (`EarnQuote`): `{ words, kind, venue, venueName, product, productName, asset, amount, usd, apy?, apyHigh?, rateKind?, lockDays?, minAmount?, protocol?, chain?, lands, note?, held?, capUsd }`.
Door: `deadline`; `hold()`: `lands` must still match, worth now ≤ `maxUsd` + 0.005 else `E_ACCOUNT_REQUOTE` "the price moved: …". Answer `kind: "result"` with `result.earn` **(inferred from mcp.ts `earnView` reading `b.result.earn`)**.

### 3.8 Admit an agent — `approveAgent` (agents-mount.js, ui/portfolio.js `pfLetIn`, desk.js)

Draft: `{ type: "approveAgent", agentAddress: "0x<40 hex, lower-cased by the page>", agentName: "<1..32 chars>", validUntil: nowMs() + days * DAY }`
(`days` ∈ 1/7/30/90). **Revoke** = the same type with `agentAddress: "0x0000000000000000000000000000000000000000"` (`ZERO`) and the key's name,
`validUntil: 0` (Hyperliquid's way; "agent key \"<name>\" revoked"; the address is tombstoned for good). Rules (`applyOwner`): name plain text ≤ 32,
expiry in the future and ≤ 180 days (`MAX_AGENT_DAYS`), ≤ 12 live keys (`MAX_AGENTS`), a revoked address never again (`E_ACCOUNT_LIMIT`), an owner
address cannot be an agent, a look-alike name is refused, a new key under an existing name retires the old one. Summary: `agent key "<name>" authorised until <date>`.
Where the address comes from: `GET /api/account.requests[]` (`{ address, name, at }` — keys that knocked, `E_ACCOUNT_UNKNOWN_SIGNER` rows) or typed.

### 3.9 Grant a limit — `approveSpend` (agents-mount.js form, portfolio.js `pfLimitForm`, intent.js, desk.js)

Draft: `{ type: "approveSpend", agent: "0x…", scope: "trade" | "venues" | "payees" | "earn", allow: "*" | "okx,alpaca" | "api.example.com,…" | "okx:savings:USDT", perPayment: "<decimal>", budget: "<decimal>", windowHours: 0, validUntil: nowMs() + days * DAY, intent?: "intent-0003", renewHours?: <hours> }`.
Prepare deletes `intent` when `""` and `renewHours` when `undefined/null/""/0` (so a plain limit signs with the 7 base fields); an earn limit with `*` is refused before it is shown (`EARN_NAMES`).
Rules: `*` on an own-venue scope is written out as the venues on the account NOW (`native.allow` on the row); amounts plain decimals, `0 < perPayment ≤ budget`; expiry future and ≤ 180 days; `intent` must be an open intent addressed to that agent or `*`; `renewHours` only on `scope: "trade"`, 1..4320 whole hours; payees `*` only with a real payer.
**Revoke a limit** = `budget: "0"` (`endLimitDraft`: same agent/scope/allow, `perPayment: "0"`, `budget: "0"`, `windowHours: 0`, `validUntil: nowMs() + DAY`) → "trading limit revoked" / "earn limit revoked" / "spending approval (<scope>) revoked".
One standing approval per agent and scope: a new one replaces the old. The agents-mount form issues several in sequence (trade, then venues, then payees) — each its own signature.

### 3.10 Admit a second device / change signers — `convertToMultiSigUser`

Draft: `{ type: "convertToMultiSigUser", signers: "<JSON {\"authorizedUsers\":[...sorted ids],\"threshold\":N}>" }` — see 1.4. Summary `signers changed: N of M`.

### 3.11 Policy — `setPolicy` (`{ change, value }`; service.ts `widen`, exchange.ts for `close-session`)

| change | value | effect / summary |
|---|---|---|
| `mode` | `"open"` | Beast on ("Beast: agents trade and move inside their limits without asking"); Guard is the unsigned `POST /api/mode { mode: "guard" }` |
| `cap` | `"<dollars, ≤7 digits, ≤2 decimals, > 0>"` | the per-order/movement cap (`--live-cap` is only the start); refused on a read-only server |
| `maxLeverage` | `"<1..3 digits ≥ 1>"` | the most leverage agents may set |
| `session` | any (the page sends `"30d"`) | a new 30-day agents' session from now |
| `restore` | `<venue id>` | the venue open to agents again (its closing is the unsigned `POST /api/revoke { account }`) |
| `reach` | `"<account>:<cap1>,<cap2>"` | a venue's capabilities opened to the agent (simulation-era) |
| `say` | `<text ≤ 200>` | the page's scripted agent (simulation; `data` = a flight) |
| `close-session` | `<session id or payee host>` | ends a payment session (needs a payer, else `E_PAYEE_UNSUPPORTED`) |
| `advance` · `reset` | | refused on a real account ("this account runs on the real clock…" / "it is not reset from here") |
| other | | `E_ACCOUNT_BAD_ACTION` "\"<change>\" is not a policy change the owner signs here" |

No `read-only` mode change exists as a policy: read-only is the server's `--read-only` start flag. Answer `kind: "account"` or `kind: "result"` when `widen` returns `data`.

### 3.12 Connect a venue — `connectVenue` (ui/connect.js)

Draft: `{ type: "connectVenue", venue: <id the page derives>, connector: "live:exchange:<exchange id>" | "live:<kind>" (e.g. `live:alpaca`, `live:wallet`, `live:metamask`, `live:paper`, `live:robinhood` …), label, credentialRef }`
where `credentialRef` is a key-file path (never its contents; `GET /api/account/keyfile?kind=&venue=&ref=` checks it first), a proven `0x` address, a sign-in `state`, or for a paper account its starting dollars (`""` to continue a kept book).
Rules at the door: a venue with a payment in flight or an open order cannot be (re)connected/disconnected (`E_ACCOUNT_BAD_ACTION` with `detail.payment` / `detail.order`); the host then connects or parks it as "waiting" (`WaitingConnection`). Summary = the host's words.
`GET /api/account/connect/reach?connector=` and `GET /api/account/venues` answer whether the venue serves this network before a key is made.

### 3.13 Wallet proof and OAuth sign-in (unsigned helpers that precede a `connectVenue`)

- `POST /api/account/wallet/challenge { address, wallet: "<wallet name>", chainId }` → `200 { ok: true, address, message, expiresAt }` — an EIP-4361 sentence with `domain` = the request's `Host` and `uri` = `` `${protocol}://${host}/account` ``; the browser wallet signs it with `personal_sign`; `POST /api/account/wallet/prove { address, signature }` → `{ ok: true, address, wallet }`. The address is then "proven", and `connectVenue { connector: "live:wallet", credentialRef: <address> }` follows.
- `POST /api/account/signin/start { connector }` → `{ ok: true, url, state }`; the owner's browser goes to `url`; the venue calls `GET /api/account/signin/callback?state=&code=`; `GET /api/account/signin/status?state=` → `{ status }`; then `connectVenue { credentialRef: <state> }`.

### 3.14 Disconnect — `disconnectVenue`: `{ type: "disconnectVenue", venue }`; same busy-venue rules as 3.12; an agent wallet is never disconnected.

### 3.15 Paper account — `resetPaper` · `topUpPaper`

Draft: `{ type: "resetPaper", venue, usd: "<dollars>" | "" }` (connect.js, before a `connectVenue` with `fresh` ticked) · `{ type: "topUpPaper", venue, usd }` (portfolio.js).
Prepare: `malformed`, the host's `paperWords` → `quote = { words, feeUsd: 0, receiveUsd: usd, lands: "at once", … }`; a reset is refused while an order of the account's is open there (`detail.order`). 10-min TTL (`PAPER_TTL_MS`).

### 3.16 Answer a card — `approveCard`: section 4.

### 3.17 Decline an ask — `answerAsk`: `{ type: "answerAsk", ask: "ask-0003", decision: "decline" }` (`"decline"` is the only decision; granting an ask is the owner's own action for it, which closes it). An ask re-asked meanwhile → `E_ACCOUNT_BAD_ACTION` "<agent> changed this ask since it was shown (it is ask-000N now)…".

### 3.18 Say / intent — `setIntent` (ui/intent.js "Hand to agent")

Draft: `{ type: "setIntent", id: "" | "intent-0003", agent: "0x…" | "*", venue: "" | <id>, symbol: "" | "<≤80 plain>", side: "" | "buy" | "sell", usd: "" | "<decimal>", text: "<1..200 plain chars>", validUntil: <ms> }`; `validUntil: 0` withdraws `id`.
Optionally a second signature, a trading/earn `approveSpend` naming the intent: new words are signed first, the page reads `/api/account` to learn the id the account gave them (`htaIdOf`), prepares the limit again with `intent: <id>`, shows it, signs it. "What you sign" lists both (`· 1 your words`, `· 2 its limit`).

### 3.19 Watch — `setWatch`: `{ type: "setWatch", venue, symbol, on: "true" | "" }` (ui/markets.js; `""` stops watching).

### 3.20 Memory — `setMemory { scope: <agent address>, id: "" | "note-0003", topic: "style" | "rules" | "venues", text }` · `forgetMemory { scope, what: "note-0003" | "all" }` · `setMemoryRules { scope, learn, ask, share }` each `"on" | "off"` (ui/memory.js). Answers `kind: "result" { note, summary }` / `kind: "account"`.

### 3.21 The desk — `setDesk { desk: "desk", change, value }` (ui/desk.js, superagent.js, brains.js)

`change` ∈ `hire · objective · brain · charter · seat · autonomy · pause · resume · end · cycle · report` (desk.ts; anything else → "… is not a change the desk takes"); `value` is JSON text (`""` = `{}`):
`hire` `{ name, objective: { text, venue, universe, targetPct, maxRiskPct, maxDailyLossPct, hours, everyMin, reportAt }, brain, roles: [{ role, kind: "house" | "outside", address? }], autonomy?: { paper: true } }`;
`objective` `{ text, venue, universe, targetPct, maxRiskPct, maxDailyLossPct, everyMin, maxOpen, reportAt }`; `charter` `{ role, owns, good, never }`;
`seat` `{ role, kind: "house" | "outside" | "empty", address? }`; `autonomy` `{ paper: boolean }`; `resume` `{ autonomy?: { paper: true } }`; `brain` `{ provider, model, … }` (refused before the door when a key-shaped string is in it); `pause`/`end`/`cycle`/`report` `""`.
desk.js's "Hire" runs several signatures in sequence (`approveAgent` per house seat, `approveSpend` per trading seat, then `setDesk hire`); superagent.js the same via `Owner.act` step by step — the first refusal stops the rest.

### 3.22 A brain's key — `setBrainKey` (ui/brains.js; `POST /api/account/brain-key`, NOT `/api/exchange`)

Draft: `{ type: "setBrainKey", provider: "deepseek" | "openai" | "claude" | …, baseUrl: "" | url, model: "" | name, keyHash: "<hex sha256(salt ‖ key)>" | "", salt: "<hex 16 bytes>" | "" }` — the key itself never enters a draft or an envelope.
Page: `Owner.prepare(draft)` then `Owner.submitTo("/api/account/brain-key", prepared, { apiKey: <typed> })` → body `{ apiKey, envelope: { action, nonce, signature } }` (`submitTo` only accepts paths matching `/^\/api\/account\/[a-z0-9/-]+$/`). A clear is the same with `keyHash: ""`, `salt: ""` and no `apiKey`.
Server: its own ≤ 4 KB reader, the key checked against the signed fingerprint before the door, staged under `actionHash` while the envelope runs through the ordinary door (10-min TTL), the provider's key file written; answer `{ ok: true, provider, fingerprint?, tail?, keyless?, cleared?, label?, standing?, envWins?, envBlocks? }`; `409 { error: BODY_WORDS.busy | BODY_WORDS.replay }`, `415`/`413`/`400` with fixed sentences. The face does not need this route; it is listed to show it is the one exception to "everything signed goes to /api/exchange".

### 3.23 Agent wallet — `createSubAccount { name: "<1..16>", agent: "0x…", float: "<decimal>" }` (money.js, portfolio.js) — real account only with agent wallets mounted (`host.agentWalletAddress`).

### 3.24 Sign out — `signOut { device: "device:<kid>" }`: section 1.5.

---

## 4. The Guard-card path for the owner

### 4.1 Discovery

- **Read:** `GET /api/account` → `cards: [{ id: "card-0001", flight, usd, reason, hash, kind, agent?, agentName?, expiresAt?, shown: [{ name, value }] }]`
  (only `status: "pending"` cards). `kind` = the agent's instruction type (`agentLiveOrder`, `agentLiveMove`, `agentLiveAmend`, `agentLiveClose`,
  `agentLiveLeverage`, `agentLiveEarn`, `agentPay`, `agentSendAsset`) or an intent kind for a card the older write path raised. `shown` =
  the card's `offer` entries (`payee`, `payTo`, `amount`, `protocol`, `network`, `fee?`, `deposit?`, `escrow?`) followed by every field of the
  agent's signed action except `type`, `mandates`, `cnf` (values stringified; objects as JSON). `hash` = `cardHash(card)`.
  Also `GET /api/overview.approvals[]` with `hash` (the classic page), and `GET /api/account/agents`, `/api/account/desk` list cards per agent/desk.
- **Push:** `GET /api/account/stream` (text/event-stream; `retry: 1000`; frames `id: <run>.<seq>` / `event: <type>` / `data: <JSON>`; `hb` every 15 s;
  `Last-Event-ID` or `?since=` resumes from a 500-event ring, else a `snapshot` event; one stream per tab, `MAX_CLIENTS = 32`, past it `503`;
  `?client=` (8–48 `[A-Za-z0-9_-]`) names the tab for market following). A card raised or answered is `event: card` with
  `{ id: "card-0001", venue, outcome: "pending" | "approved" | "rejected", at }` (from the ledger's `card` rows, `toldRow`); things that wait
  for the owner WITHOUT a card are also `event: card` with `{ waits: "letIn" | "ask" | "memory" | "device", venue, at }`. The page re-reads
  `/api/account` on these (ui/stream.js `stOn("card", …)` in shell.js). Account events: `order, fill, position, balance, paper, statement, card, desk`.
- `GET /api/account.modeRules.cardMinutes` = 30 (`CARD_TTL_MS = 30 * 60_000`); `card.expiresAt` is set when raised.

### 4.2 What the card holds

`CardLike` (exchange.ts): `{ id, account, intent, usd, reason, status: "pending" | "approved" | "rejected", flight, batch?, action?: AgentAction, actionHash?, signer?: <agent address>, expiresAt?, payment?, offer?: CardOffer, approval?: <spend id> }`.
For a live order (live-orders.ts `agent()`): `offer = { payee: <venue name>, payTo: <symbol>, amount: "<side> <qty> <base>", protocol: "real order · <type>[ at <limit>| near <price>]" | "paper order (no real money) · …", network: "costs at most $X" | "worth about $X" }`,
`actionHash = keccak256(canonical({ action: <EIP-712 hash of the agent's agentLiveOrder>, offer, symbol, qty, price, worth }))`, `reason: "<agent> asks to <words>"`, `usd` = worth, and the card holds `worth` of the agent's limit (`reservedMicro`) until answered. A close signs
`{ action, offer, symbol, qty, worth }`; a movement's and an earn's cards are built by their doors in the same style **(inferred for move/earn)**.

### 4.3 Approve / reject — `approveCard`

Draft (ui/portfolio.js, desk.js, superagent.js, the classic shim): `{ type: "approveCard", card: c.id, action: c.hash, decision: "approve" | "reject" }` → prepare (generic branch) → sign → `/api/exchange`.
"What you sign": `card`, `action` (the 0x hash), `decision`, `nonce`. The hash is what binds the answer to exactly what the owner was shown (market, size, price, worth, offer) — the agent's request alone cannot be approved under a different quote.
`MONEY_TYPES` → the envelope must be dated within 10 min; `approve-all` loops cards one signature each, stopping at the first refusal.

Door (`answerCard`):
- unknown or not pending → `E_CARD_NOT_GRANTED` "no pending card <id>"; expired already by `expireCards` → `E_ACCOUNT_CARD_EXPIRED { detail: { card, expiredAt } }`; `action !== cardHash(card)` → `E_ACCOUNT_BAD_SIGNATURE` "this approval names a different instruction than the one the card holds"; expired now → the card is closed rejected, `E_ACCOUNT_CARD_EXPIRED`.
- a ledger row `{ tool: "approveCard", outcome: <decision>, intentId: card.id, flight }`.
- **reject** → the held limit is released, `closeCard(id, "rejected", "You rejected it; nothing moved")`, answer `200 { ok: true, kind: "result", result: { ok: false, code: "E_CARD_REJECTED", … }, flight }` (the page reads `result.ok === false` as refused but it is a 200).
- **approve** → the agent's instruction is run again from the top (`release` / `releaseAmend` / `releaseClose` / `releaseLeverage` / `earn.release` / `move` / `payer.pay`): its key must still stand (`E_ACCOUNT_AGENT_EXPIRED` / `E_ACCOUNT_AGENT_REVOKED`), its limit, the dial, the venue — only the card itself is not asked twice. Answer = that outcome (`kind: "order"` …) or its refusal; the card is closed `"approved"` either way (a refusal keeps the note "Approved, but it no longer passes: …").
- A card nobody answers in 30 minutes is closed rejected by `expireCards` ("The card expired before it was answered; nothing moved") and its hold released; the owner answering later gets `E_ACCOUNT_CARD_EXPIRED`.

The unsigned `POST /api/approve { id, decision }` answers `401 E_ACCOUNT_OWNER_SURFACE` once the account layer is mounted.

---

## 5. The agent-side counterpart, in one paragraph

An admitted agent (an MCP seat, `src/portfolio/mcp.ts`) holds a secp256k1 key (plus a P-256 one for AP2 mandates) in `<home>/seats/<slug>.json`
(0600, `keystore.ts`; the face's seat is `~/.buyer-agent-demo/seats/gravit.json`), never a device key. It signs a single EIP-712 type for every request:
domain `AgentAccountExchange` v1 chainId 424242, `Agent(source: "sim", actionHash: keccak256(canonical(action)), nonce)`, with `signAgent` → `{ action, nonce, signature: { r, s, v } }`,
the nonce from `GET /api/now`.ms (monotonic per process), POSTed to the same `/api/exchange`. The door classifies by `action.type`: `AGENT_TYPES` =
`agentSendAsset, agentSwap, agentPay, agentExecute, agentOrder, agentLiveMove, agentLiveOrder, agentLiveCancel, agentLiveAmend, agentLiveClose, agentLiveLeverage, agentReport, agentAsk, agentLiveEarn, agentRemember, agentForget, agentDeskSay`
(17; `agentLiveOrder` fields: `venue, symbol, side, orderType, qty, usd, limitPrice` + optional `stopPrice, tif, postOnly, reduceOnly, extendedHours, trailPercent, trailPrice, takeProfit, stopLoss`, all strings). An agent key can never sign an owner type (`E_ACCOUNT_OWNER_ONLY`), a device key
can never sign an agent type, and an unknown key is remembered under `requests[]` (knocking as `agentAsk { kind: "letIn", text: <name> }`) without spending a nonce. Inside its `approveSpend`
limit, Guard turns an order/move/earn/amend/close into a card the owner answers (section 4); Beast runs it at once; cancels never card.
The boundary: everything that widens, connects, admits, grants, closes a device or answers a card is an owner type signed by a device (or EOA)
key; everything an agent does is judged by a limit the owner signed and by the dial.

---

## 6. Risks and surprises for a second-origin device (the face at 127.0.0.1:3090)

1. **Direct browser calls are impossible.** The origin guard refuses `Origin: http://127.0.0.1:3090` and `Sec-Fetch-Site: same-site` on every
   route (section 0), the SSE stream included. The face's page can only sign; every HTTP call — pair, prepare, exchange, the reads, the stream —
   has to go through the face's Node process, which must send `Host: 127.0.0.1:4820` and no `Origin`/`Sec-Fetch-Site`. One SSE stream per tab
   counts toward the Account's 32 (`503` past it); the proxy should hold one per face tab or fan one out.
2. **The key is bound to the face's origin, not to the Account's.** IndexedDB/WebCrypto keys are per origin, so the face's page is a new
   device with its own `kid`; nothing of the operator's existing browser key carries over. Fine — but the face's device key disappears with
   the browser profile/origin data, and a cleared site storage = a device gone without a `signOut` (its owner entry stays until another
   owner signs a `convertToMultiSigUser` without it; the kid list is otherwise unbounded by the Account).
3. **A second device is admitted only by an existing owner's signature** (`convertToMultiSigUser` from the Account page's Settings › Devices
   "Let it sign", or from any owner device the face itself implements). The pairing code is never enough for a second device; it is checked
   only while the account has no owner. The stand-in (`test/standin/ui-standin.ts`) auto-admits on the code, so a drill that passes on the
   stand-in says nothing about this step on the real service. Up to 10 devices may wait; a restart drops the waiting list (re-pair).
4. **Pairing order decides who can admit whom.** If the face pairs first on an ownerless account (fresh home, or after the last sign-out),
   the operator's browser becomes the pending one and only the face can admit it — the face then needs a Devices UI, or the operator signs
   out of the face to regenerate the code. Safer sequence: operator's browser owns first, the face is admitted second.
5. **The signed bytes must be rebuilt from `prepared.shown`, not from `action`.** The page composes `message` from `shown` strings +
   `accountChain`, with `domain` = `{ name, version, chainId }` only (no `verifyingContract`), canonical JSON (sorted keys, `undefined` dropped, no
   whitespace), uint64s as decimal strings, and signs the UTF-8 bytes with ECDSA P-256/SHA-256, raw `r‖s` base64url. Any JSON stringifier that
   keeps insertion order, emits `null`, or pads base64 produces `E_ACCOUNT_BAD_SIGNATURE`. The envelope's `action` must be exactly
   `prepared.action` (numbers stay numbers; `nonce` repeated at the top level).
6. **Everything money is 10 minutes.** `liveOrder/liveAmend/liveMove/liveEarn` carry a `deadline` (real clock + 10 min) AND their nonce must be
   within ±10 min of the service clock; `liveClose/liveLeverage/approveCard/signOut/resetPaper/topUpPaper/setBrainKey` have the nonce rule only.
   A prepared action held on a face page across a long approval wait is dead; re-prepare (the page re-prepares at 0 and before signing when < 30 s remain).
7. **Replays are answered, not refused.** The same envelope sent twice within 2 days returns the first answer with its original status
   (a `202` or `409` included); a face retry layer must not treat the repeat as a new execution. After a restart the same hash is `E_ACCOUNT_NONCE`.
8. **Nonces are per device and monotone-ish.** Only the 100 highest per signer are kept; a nonce below the smallest of them is `below-floor`.
   Prepare hands out `max(now, last+1)` on the service clock, which several face tabs would share correctly only if they all take it from
   prepare (never from the face's own clock, which may skew). An agent seat's nonce source (`/api/now`) is separate.
9. **One signature per device, threshold 1.** The page never raises `threshold`; if someone does, every owner action needs `cosignatures`
   from other owners over the same action — a flow neither the page nor the face implements. `E_ACCOUNT_THRESHOLD` would then refuse every face action.
10. **`kind: "result"` can wrap a refusal with HTTP 200** (a rejected card, a wallet-sent move): the face's "done" test must mirror `refusedAt`.
11. **A pending device signs nothing, and reads say so only indirectly:** its signatures are `E_ACCOUNT_BAD_SIGNATURE` (401), not "unknown
    signer"; the face should read `signers.pendingDevices` / `signers.owners` on each `/api/account` to know its standing and re-pair when
    the service restarted (its kid vanishes from both lists).
12. **Sign-out is self-only and final for the key**: a face device can only sign itself out; the last device out regenerates the pairing code
    (printed only in the Account's terminal/log — the face cannot read it), and an owner left out of a `convertToMultiSigUser` list is dropped
    without any sign-out. Beast left on with no owner device keeps agents running inside their limits (the page offers Guard first).
13. **An EOA owner is an alternative to a device** **(inferred option)**: `convertToMultiSigUser` also admits a lower-case `0x` address
    (`kind: "eoa"`), which signs the same owner typed data with secp256k1 (`signOwner` via viem `signTypedData`, signature `{ r, s, v }`). The
    face's Node process could hold such a key and sign without any browser WebCrypto — but it cannot pair through `/api/account/pair`, cannot
    `signOut`, and is labelled "Wallet key" on the Devices list.
14. **Wallet proofs name the Account's host**: an EIP-4361 challenge made through the proxy says `domain 127.0.0.1:4820`, `uri http://127.0.0.1:4820/account`,
    which the operator's wallet will display; a browser wallet (`window.ethereum`) lives in the face's page, so `connect.js`'s flow would run
    on the face's origin against a challenge for the Account's — allowed by the Account (it checks only the signature), but visible to the operator.
15. **Real-only vocabulary**: on the default (real) server `sendAsset`, `swap`, `setDestination`, `userSetAbstraction`, `approveBuilderFee`, `createSubAccount`
    (without agent wallets) and `setPolicy advance/reset` are refused; a face UI should not offer them. `setPolicy cap` and every live door are refused on a `--read-only` server (`E_WALLET_LIVE_WRITES_OFF`).

### Could not determine (not read, or not in the install)

- The exact `result` object shapes of `liveLeverage`, `liveEarn`, and the paper/wallet `result` variants beyond what the UI reads (marked inferred above).
- Whether undici's `fetch` in the face's Node version adds any `sec-fetch-site` header (the guard would refuse `same-site`/`cross-site`); a `node:http` request sends none.
- `express.json` body limit on `/api/exchange` (express's default 100 kb, not set explicitly).
- Operator documentation: `README.md` and `docs/account.md` (Chinese) mention Devices › "Let it sign" and the 10-device cap, but do not describe a cross-origin device; the design above is read from the code alone.
