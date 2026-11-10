/** The account signs only acts that move money (sign-only-money), on a real boot: the Account's own stand-in (no network, a fresh
 * temp home) and the face booted with `FACE_ACCOUNT_URL` at it, every call to the face's own port. A first browser pairs with the
 * code the stand-in printed; a second asks for a code of its own (Get a code: the pair route with `ask`), the account prints it on
 * its stdout, the browser types it and signs. A third page, which never paired and holds no standing, opens a paper account
 * through the unsigned door (`/data/account/act`), and the same venue id is then refused. Nothing of a body — the pairing code,
 * the asked code, the act's body — is in what the face's process wrote.
 *
 * Skipped unless `FACE_SMOKE=1` and the repo's `account/` is installed, as `account-graft-smoke` is, whose boot this mirrors: the
 * install read, never written; the stand-in on a free port, never 4820; the seat row disabled; ONE BOOT PER PROCESS. */
import { DEAD_MARKET_URL } from "./helpers/no-market.ts";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupFaceProfile } from "../src/setup.ts";
import { bootFace } from "../src/boot.ts";
import { registerAccountProxy } from "../src/account-proxy.ts";
import { makeBotsRoot } from "./bots-fixture.ts";
import { freePort, parseStandinLines, standinSkip, startStandin, stopStandin, type Standin } from "./helpers/standin.ts";
import { startOwnerNode, type OwnerAnswer, type OwnerNode } from "./helpers/owner-node.ts";

const skip = standinSkip();

/** How long the stand-in has to print the code a browser asked for. */
const ASK_LINE_MS = 10_000;
/** The paper account the page that does not sign opens: an id and a name no seeded venue has. */
const PAPER_VENUE = "paper-code-smoke";
const PAPER_LABEL = "Code smoke paper 7f3a";
const PAPER_ACTION = { type: "connectVenue", venue: PAPER_VENUE, connector: "live:paper", label: PAPER_LABEL, credentialRef: "12345" } as const;

/** Everything this process writes to stdout and stderr from now on — the face runs in it — still written through. */
function captureOutput(): { text: () => string; restore: () => void } {
  const heard: string[] = [];
  const tee = (stream: NodeJS.WriteStream): (() => void) => {
    const write = stream.write.bind(stream);
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      heard.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    return () => { stream.write = write; };
  };
  const undo = [tee(process.stdout), tee(process.stderr)];
  return { text: () => heard.join(""), restore: () => { for (const back of undo) back(); } };
}

/** The code the stand-in printed for the browser whose key id starts `kid8`, waited for up to `ms`. */
async function askedCodeFor(standin: Standin, kid8: string, ms: number): Promise<string | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const code = parseStandinLines(standin.log())?.asks[kid8];
    if (code !== undefined || Date.now() >= deadline) return code;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const shown = (r: OwnerAnswer): string => `${r.status} ${JSON.stringify(r.body).slice(0, 600)}`;

describe("account code smoke: pairing by code and an unsigned paper opening, through the face's own port", { skip, timeout: 300_000 }, () => {
  let standin: Standin | undefined;
  let home: string | undefined;
  let base = "";
  let dispose: (() => Promise<void>) | undefined;
  let disposeProxy: (() => void) | undefined;
  const devices: OwnerNode[] = [];
  let output: ReturnType<typeof captureOutput> | undefined;
  const wasUrl = process.env.FACE_ACCOUNT_URL;
  /** The code the second browser typed, kept for the output check. */
  let askedCode: string | undefined;
  const said = (): string => `\nstand-in:\n${standin?.log() ?? ""}`;

  /** The Account's page as the face proxies it, fresh. */
  type Page = { signers?: { owners?: { id?: string }[]; pendingDevices?: { kid?: string }[] }; venues?: { id?: string; name?: string; paper?: boolean }[] };
  const page = async (): Promise<Page> => (await (await fetch(`${base}/data/account?fresh=1`)).json()) as Page;

  before(async () => {
    standin = await startStandin(await freePort());
    home = mkdtempSync(join(tmpdir(), "face-code-home-"));
    /* What the face's process says, from its boot on: no code and no act body may be in it. */
    output = captureOutput();
    setupFaceProfile(home);
    const patchPath = join(home, "profiles", "face", "cordis.patch.yml");
    writeFileSync(patchPath, `${readFileSync(patchPath, "utf8").replace(/^\[\][ \t]*$/m, "")}\n- id: mcp-account\n  disabled: true\n`);
    process.env.FACE_ACCOUNT_URL = standin.url;
    process.env.FACE_MARKET_URL = standin.marketUrl;
    const booted = await bootFace({ profileName: "face", port: 0, dshHome: home, botsRoot: await makeBotsRoot() });
    dispose = booted.dispose;
    disposeProxy = registerAccountProxy(booted.ctx.webServer, { url: standin.url }).dispose;
    base = `http://127.0.0.1:${booted.ctx.webServer.port}`;
  });

  after(async () => {
    output?.restore();
    for (const device of devices) device.close();
    if (dispose) await dispose();
    disposeProxy?.();
    if (wasUrl === undefined) delete process.env.FACE_ACCOUNT_URL; else process.env.FACE_ACCOUNT_URL = wasUrl;
    process.env.FACE_MARKET_URL = DEAD_MARKET_URL;
    if (standin) await stopStandin(standin);
    if (home) await rm(home, { recursive: true, force: true });
  });

  test("a second browser asks for a code, types the one the account printed, and signs", async () => {
    assert.ok(standin);
    /* The first browser: the stand-in's own pairing code, the account's first signer. */
    const first = startOwnerNode(base, "Code smoke first");
    devices.push(first);
    await first.owner.ready(standin.code);
    assert.equal(first.standing().role, "signs", `the first browser signs: ${JSON.stringify(first.standing())}${said()}`);

    /* The second: it knocks and waits, then asks for a code of its own. */
    const second = startOwnerNode(base, "Code smoke second");
    devices.push(second);
    await second.owner.ready();
    assert.equal(second.standing().role, "pending", `the second browser waits: ${JSON.stringify(second.standing())}${said()}`);
    const kid = second.standing().kid;
    assert.match(kid, /^[0-9a-f]{16}$/);
    assert.ok((await page()).signers?.pendingDevices?.some((d) => d.kid === kid), "the account lists the second browser as waiting");
    await second.owner.askCode();
    assert.equal(second.standing().role, "asked", `the second browser asked: ${JSON.stringify(second.standing())}${said()}`);
    assert.equal(second.standing().refusal, null);

    /* The account printed one line for it, on its own stdout: the code, by the first eight of its key id. */
    askedCode = await askedCodeFor(standin, kid.slice(0, 8), ASK_LINE_MS);
    assert.ok(askedCode, `the account printed a code for ${kid.slice(0, 8)} within ${ASK_LINE_MS / 1000} s${said()}`);
    assert.notEqual(askedCode, standin.code, "a browser's own code is not the first pairing code");
    assert.ok(!output!.text().includes(askedCode), "the asked code is not in the face's output");

    /* Typed on that page: the second browser signs, and the account counts it among its signers. */
    await second.owner.ready(askedCode);
    assert.equal(second.standing().role, "signs", `the second browser signs: ${JSON.stringify(second.standing())}${said()}`);
    assert.equal(second.standing().refusal, null);
    const owners = (await page()).signers?.owners ?? [];
    assert.ok(owners.some((o) => o.id === `device:${kid}`), `the account's signers include device:${kid}: ${JSON.stringify(owners)}`);
    assert.ok(owners.some((o) => o.id === `device:${first.standing().kid}`), "the first browser still signs");

    /* And it signs: a watch taken and taken off again, both through the door. */
    const watched = await second.owner.act({ type: "setWatch", venue: "ex", symbol: "SOL/USDT", on: "true" });
    assert.equal(watched.status, 200, shown(watched));
    assert.notEqual(watched.body.ok, false, shown(watched));
    const unwatched = await second.owner.act({ type: "setWatch", venue: "ex", symbol: "SOL/USDT", on: "" });
    assert.equal(unwatched.status, 200, shown(unwatched));
    assert.notEqual(unwatched.body.ok, false, shown(unwatched));
    assert.equal(second.signatures().length, 2, "two signatures sent by the second browser");
  });

  test("a page that does not sign opens a paper account through /data/account/act", async () => {
    /* A page that never paired: no key made, no standing, nothing signed. */
    const page3 = startOwnerNode(base, "Code smoke unsigned");
    devices.push(page3);
    assert.equal(page3.standing().role, "unknown", JSON.stringify(page3.standing()));
    assert.ok(!(await page()).venues?.some((v) => v.id === PAPER_VENUE), `no ${PAPER_VENUE} before the act`);

    const opened = await page3.owner.unsigned({ ...PAPER_ACTION });
    assert.equal(opened.ok, true, `the account took the opening: ${JSON.stringify(opened)}${said()}`);
    const venue = (await page()).venues?.find((v) => v.id === PAPER_VENUE);
    assert.ok(venue, `the Account's page lists ${PAPER_VENUE}: ${JSON.stringify((await page()).venues?.map((v) => v.id))}`);
    assert.equal(page3.signatures().length, 0, "nothing was signed");
    assert.equal(page3.standing().role, "unknown", "the page still does not sign");

    /* The same venue id again: in use, refused in the account's words. */
    const again = await page3.owner.unsigned({ ...PAPER_ACTION });
    assert.equal(again.ok, false, `a venue id in use is refused: ${JSON.stringify(again)}`);
    assert.ok(!again.ok && again.said.length > 0, JSON.stringify(again));

    /* A signed act at the unsigned door: refused, never taken. */
    const raw = await fetch(`${base}/data/account/act`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: { type: "liveOrder" } }),
    });
    assert.equal(raw.status, 409, await raw.clone().text());
    assert.equal(((await raw.json()) as { ok?: unknown }).ok, false);
  });

  test("neither the code nor the act's body is in the face's output", () => {
    assert.ok(standin && output);
    const heard = output.text();
    assert.ok(heard.length > 0, "the face's output was heard");
    assert.ok(!heard.includes(standin.code), "the pairing code is not in the face's output");
    assert.ok(askedCode, "the asked code was read (the first test ran)");
    assert.ok(!heard.includes(askedCode), "the asked code is not in the face's output");
    assert.ok(!heard.includes(JSON.stringify({ action: PAPER_ACTION })), "the act's body is not in the face's output");
    assert.ok(!heard.includes(PAPER_LABEL), "the paper account's name is not in the face's output");
    for (const device of devices) for (const signature of device.signatures()) assert.ok(!heard.includes(signature), "no signature sent is in the face's output");
  });
});
