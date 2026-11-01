/* The owner's device key.
   A P-256 key this browser makes once and cannot export; the server only ever gets its public half. An owner action is prepared by the
   server (a movement gets its route, its fee and its arrival there), shown as typed fields, and signed here over exactly those fields:
   the signing input is built in this file from what is shown, not taken from the server.
   Signing out (signOut) is this key's last signature: the account takes it no more, and the key is deleted here. A browser signed out
   stays so — no key is made or offered — until its owner signs in again (signIn). */
const Owner = (() => {
  let role = "unknown";
  let kid = "";
  /* SIGNED OUT, said in this browser's own storage: a reload, and its other tabs, stay signed out until the owner signs in again */
  const OUT = "buyer-agent-signed-out";
  const isOut = () => {
    try {
      return localStorage.getItem(OUT) === "1";
    } catch {
      return false;
    }
  };
  const setOut = (on) => {
    try {
      if (on) localStorage.setItem(OUT, "1");
      else localStorage.removeItem(OUT);
    } catch {
      // a browser that keeps nothing: this tab still forgot its key, and the account no longer takes it
    }
  };
  // another tab of this browser signed out, or signed in again: this one is read afresh as it now stands
  if (typeof addEventListener === "function") addEventListener("storage", (e) => e.key === OUT && location.reload());

  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, sortKeys(v[k])])) : v);
  const canonical = (v) => JSON.stringify(sortKeys(v));

  const open = () => new Promise((resolve, reject) => {
    const r = indexedDB.open("buyer-agent-owner", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction("keys", mode).objectStore("keys"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };

  async function key() {
    let k = await tx("readonly", (s) => s.get("device"));
    if (!k) {
      k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
      await tx("readwrite", (s) => s.put(k, "device"));
    }
    return k;
  }

  /* a POST as { status, body }; one that never reaches the account (the service restarting, the network gone) is answered as a refusal in
     the same shape, so every sheet shows it the way it shows a refusal, instead of staying at "Asking…" */
  async function post(path, body) {
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    } catch {
      return { status: 0, body: { ok: false, error: "The account did not answer. Try again." } };
    }
  }

  /** offer this browser's public key; the first device to do so becomes the owner's device — on a server that moves real money, only with
      the code that server printed in its terminal (`code`) */
  async function ready(code) {
    // signed out: nothing is made, and nothing offered to the account, until the owner signs in — a code typed on the page is that
    if (isOut() && !code) {
      role = "signed-out";
      kid = "";
      return { role };
    }
    if (code) setOut(false);
    try {
      const k = await key();
      const jwk = await crypto.subtle.exportKey("jwk", k.publicKey);
      const r = await post("/api/account/pair", { jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, label: "this browser", ...(code ? { code } : {}) });
      if (r.status !== 200) return { role, refusal: why(r) };
      role = r.body.role;
      kid = r.body.kid || "";
    } catch {
      role = "none";
    }
    return { role };
  }

  async function sign(prepared) {
    const message = { accountChain: prepared.accountChain };
    for (const f of prepared.shown) message[f.name] = f.value;
    const input = canonical({ domain: prepared.domain, primaryType: prepared.primaryType, message });
    const k = await key();
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.privateKey, new TextEncoder().encode(input));
    return { kid, es256: b64u(sig) };
  }

  const prepare = (draft) => post("/api/account/prepare", { draft });
  const submit = async (prepared) => post("/api/exchange", { action: prepared.action, nonce: prepared.action.nonce, signature: await sign(prepared) });
  /** a prepared action signed exactly as submit() signs it, sent to another of the account's own paths with something beside it that is
      never part of what is signed — the one use today: a brain's API key, typed by the owner, sent once with the setBrainKey signature to
      POST /api/account/brain-key as { envelope, apiKey }. The envelope is what /api/exchange gets ({ action, nonce, signature }), so the
      account runs it through the same door; the extra fields ride beside it, never inside it, so /prepare never saw them and the ledger,
      which keeps envelopes, never holds them. Only a path of this account (one starting "/api/account/") is accepted: a page script cannot
      send what rides here anywhere else */
  async function submitTo(path, prepared, extra = {}) {
    if (!/^\/api\/account\/[a-z0-9/-]+$/.test(String(path))) return { status: 0, body: { ok: false, error: "Not a path of this account." } };
    const envelope = { action: prepared.action, nonce: prepared.action.nonce, signature: await sign(prepared) };
    return post(path, { ...extra, envelope });
  }
  /** prepare, sign, send: what one button on the page does. Only a prepared action — fields to sign — is signed; a refusal in any shape is
      handed back as it came */
  async function act(draft) {
    const p = await prepare(draft);
    return p.status === 200 && p.body && p.body.ok !== false && Array.isArray(p.body.shown) ? submit(p.body) : p;
  }
  /** SIGN OUT: this browser's last signature — the account takes its key no more — and then the key is deleted here, so that nothing in
      this browser can sign again: not this page, another tab or a script. Deleted only once the account has taken the sign-out: a refusal,
      or no answer, leaves this browser signing as it was, and says why */
  async function signOut() {
    if (role !== "owner" || !kid) return { status: 0, body: { ok: false, error: "This browser does not sign for the account." } };
    const r = await act({ type: "signOut", device: `device:${kid}` });
    if (r.status !== 200 || !r.body || r.body.ok === false) return r;
    setOut(true);
    role = "signed-out";
    kid = "";
    try {
      await tx("readwrite", (s) => s.delete("device"));
    } catch {
      // the key could not be deleted from this browser's storage: the account no longer takes it, and this browser offers it to no one
    }
    return r;
  }
  /** SIGN IN again after signing out: a new key, offered to the account — the pairing code then, where no browser signs for it, or a wait
      until another device of the owner's lets this one in */
  async function signIn() {
    setOut(false);
    return ready();
  }

  /** a refusal as one sentence */
  const why = (r) => (r.body && r.body.refusal && r.body.refusal.message) || (r.body && r.body.error) || (r.body && r.body.result && r.body.result.message) || "";

  return { ready, prepare, submit, submitTo, act, signOut, signIn, why, get role() { return role; }, get kid() { return kid; } };
})();
