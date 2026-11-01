/**
 * Lunhui's adapter onto the Account, `plugins/lunhui/lib/account-fetch.mjs`: each upstream GET goes
 * to the Account's relay, the one 问财 POST to its iFinD route, and every answer or refusal comes
 * back as the codes `fetchBytes` and `upstreamError` already know. A recording `fetchImpl` stands in
 * for the Account; nothing reaches the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  accountFetch,
  accountOrigin,
  DEFAULT_ACCOUNT_URL,
  IFIND_CREDENTIAL,
  IFIND_UNCONFIGURED,
  WENCAI_QUERY_URL,
} from "../plugins/lunhui/lib/account-fetch.mjs";

const ORIGIN = "http://127.0.0.1:4820";

type Sent = { url: string; init: RequestInit };
function account(answer: (sent: Sent) => Response | Promise<Response> = () => upstream(200, "ok")) {
  const sent: Sent[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const s = { url: String(url), init: init ?? {} };
    sent.push(s);
    return answer(s);
  };
  return { sent, fetch: accountFetch(ORIGIN, { fetchImpl }) };
}
function upstream(status: number, body: BodyInit | null, headers: Record<string, string> = {}, mark = "x-cn-relay") {
  return new Response(body, { status, headers: { [mark]: "upstream", "content-type": "text/plain", ...headers } });
}
function refused(status: number, word: string, route: "relay" | "ifind" = "relay") {
  return new Response(JSON.stringify({ ok: false, [route]: word }), {
    status,
    headers: { [`x-cn-${route}`]: "refused", "content-type": "application/json" },
  });
}
async function rejectsWith(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string; cause?: unknown };
  }
  assert.fail("expected a rejection");
}

test("the default address is the Account's own", () => {
  assert.equal(DEFAULT_ACCOUNT_URL, "http://127.0.0.1:4820");
  assert.equal(WENCAI_QUERY_URL, "https://quantapi.51ifind.com/api/v1/smart_stock_picking");
});

test("accountOrigin takes an origin and nothing else", () => {
  assert.equal(accountOrigin("http://127.0.0.1:4820"), "http://127.0.0.1:4820");
  assert.equal(accountOrigin("http://account:4820/"), "http://account:4820");
  for (const bad of ["ftp://x", "http://u:p@h", "http://h/api", "http://h?x=1", "http://h/#top", "", 42, undefined]) {
    assert.throws(() => accountOrigin(bad), TypeError, String(bad));
  }
});

test("a GET goes to the relay with the upstream URL and three headers", async () => {
  const a = account();
  const target = "https://push2.eastmoney.com/api/qt/clist/get?fs=m:90+t:3&fid0=f62";
  const signal = new AbortController().signal;
  await a.fetch(target, {
    signal,
    redirect: "error",
    headers: { Accept: "*/*", Referer: "https://quote.eastmoney.com/", "User-Agent": "lunhui", Cookie: "x=1" },
  });
  assert.equal(a.sent.length, 1);
  const [{ url, init }] = a.sent;
  assert.ok(url.startsWith(`${ORIGIN}/api/cn/relay?url=`));
  assert.equal(url, `${ORIGIN}/api/cn/relay?url=${encodeURIComponent(target)}`);
  assert.equal(new URL(url).searchParams.get("url"), target);
  assert.equal(init.method ?? "GET", "GET");
  assert.equal(init.redirect, "manual");
  assert.equal(init.signal, signal);
  assert.deepEqual(init.headers, { accept: "*/*", referer: "https://quote.eastmoney.com/", "user-agent": "lunhui" });

  // a Headers object, any case, and a URL object read the same way
  await a.fetch(new URL(target), { method: "GET", headers: new Headers({ ACCEPT: "a", "x-other": "b" }) });
  assert.equal(new URL(a.sent[1].url).searchParams.get("url"), target);
  assert.deepEqual(a.sent[1].init.headers, { accept: "a" });
});

test("the upstream's answer comes back unchanged", async () => {
  const gbk = new Uint8Array([0x76, 0x5f, 0xc6, 0xbd, 0xb0, 0xb2, 0x7e]);
  let r = await account(() => upstream(200, gbk, { "content-type": "text/plain; charset=GBK" })).fetch("https://qt.gtimg.cn/q=sh600000");
  assert.equal(r.status, 200);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), gbk);

  const moved = () => upstream(302, null, { location: "https://elsewhere.example/" });
  r = await account(moved).fetch("https://push2ex.eastmoney.com/getTopicZTPool", { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "https://elsewhere.example/");

  const e = await rejectsWith(account(moved).fetch("https://qt.gtimg.cn/q=sh600000", { redirect: "error" }));
  assert.ok(e instanceof TypeError);
  assert.equal(e.message, "redirect refused");
  assert.equal(e.code, undefined);
  await rejectsWith(account(moved).fetch("https://qt.gtimg.cn/q=sh600000"));

  r = await account(() => upstream(404, "nope")).fetch("https://qt.gtimg.cn/q=sh600000");
  assert.equal(r.status, 404);
});

test("the relay's refusals become the codes fetchBytes knows", async () => {
  const url = "https://qt.gtimg.cn/q=sh600000";
  assert.equal((await rejectsWith(account(() => refused(504, "timeout")).fetch(url))).code, "PROVIDER_TIMEOUT");
  assert.equal((await rejectsWith(account(() => refused(502, "too-large")).fetch(url))).code, "RESPONSE_TOO_LARGE");
  for (const [status, word] of [[403, "not-listed"], [502, "unreachable"], [503, "off"]] as const) {
    const e = await rejectsWith(account(() => refused(status, word)).fetch(url));
    assert.equal(e.code, undefined);
    assert.match(e.message, new RegExp(word));
  }
});

test("an Account without the relay, or none at all, is a code-less failure naming the Account", async () => {
  const url = "https://qt.gtimg.cn/q=sh600000";
  let e = await rejectsWith(account(() => new Response("Not Found", { status: 404 })).fetch(url));
  assert.equal(e.code, undefined);
  assert.match(e.message, /http:\/\/127\.0\.0\.1:4820/);
  assert.match(e.message, /HTTP 404/);

  const down = new TypeError("fetch failed");
  e = await rejectsWith(account(() => Promise.reject(down)).fetch(url));
  assert.equal(e.code, undefined);
  assert.equal(e.cause, down);
  assert.match(e.message, /http:\/\/127\.0\.0\.1:4820/);
});

test("the 问财 query goes to the iFinD route, its token-free body only", async () => {
  const mark = "x-cn-ifind";
  const a = account(() => upstream(200, '{"errorcode":0}', { "content-type": "application/json" }, mark));
  const signal = new AbortController().signal;
  const r = await a.fetch(WENCAI_QUERY_URL, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", access_token: "secret-access" },
    body: JSON.stringify({ searchstring: "A股 涨跌幅", searchtype: "stock" }),
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '{"errorcode":0}');
  assert.equal(a.sent.length, 1);
  const [{ url, init }] = a.sent;
  assert.equal(url, `${ORIGIN}/api/cn/ifind`);
  assert.equal(init.method, "POST");
  assert.equal(init.signal, signal);
  assert.equal(init.body, JSON.stringify({ query: "A股 涨跌幅" }));
  assert.deepEqual(init.headers, { "content-type": "application/json" });
  assert.doesNotMatch(JSON.stringify(init), /access_token|refresh_token|secret-access/);

  const post = (answer: () => Response) =>
    account(answer).fetch(WENCAI_QUERY_URL, { method: "POST", body: JSON.stringify({ searchstring: "A股" }) });
  assert.equal((await rejectsWith(post(() => refused(503, "unconfigured", "ifind")))).code, IFIND_UNCONFIGURED);
  assert.equal(IFIND_UNCONFIGURED, "IFIND_UNCONFIGURED");
  assert.equal((await rejectsWith(post(() => refused(502, "credential", "ifind")))).code, IFIND_CREDENTIAL);
  assert.equal(IFIND_CREDENTIAL, "IFIND_CREDENTIAL");
  assert.equal((await rejectsWith(post(() => refused(504, "timeout", "ifind")))).code, "PROVIDER_TIMEOUT");
  assert.equal((await rejectsWith(post(() => refused(502, "too-large", "ifind")))).code, "RESPONSE_TOO_LARGE");
  const other = await rejectsWith(post(() => refused(400, "not-the-query", "ifind")));
  assert.equal(other.code, undefined);
  assert.match(other.message, /not-the-query/);
  const old = await rejectsWith(post(() => new Response("Not Found", { status: 404 })));
  assert.equal(old.code, undefined);
  assert.match(old.message, /127\.0\.0\.1:4820/);
});

test("nothing else is sent", async () => {
  const a = account();
  const attempts: Array<[string, RequestInit]> = [
    ["https://quantapi.51ifind.com/api/v1/get_access_token", { method: "POST", headers: { refresh_token: "r" }, body: "{}" }],
    ["https://qt.gtimg.cn/q=sh600000", { method: "PUT" }],
    ["https://qt.gtimg.cn/q=sh600000", { method: "POST", body: "{}" }],
    [WENCAI_QUERY_URL, { method: "POST", body: "not json" }],
    [WENCAI_QUERY_URL, { method: "POST", body: JSON.stringify({ searchtype: "stock" }) }],
  ];
  for (const [url, init] of attempts) {
    const e = await rejectsWith(a.fetch(url, init));
    assert.equal(e.code, undefined);
  }
  assert.equal(a.sent.length, 0);
});

test("an aborted signal aborts the Account's request", async () => {
  const a = account(
    ({ init }) =>
      new Promise((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      }),
  );
  const ctl = new AbortController();
  const pending = a.fetch("https://qt.gtimg.cn/q=sh600000", { signal: ctl.signal });
  const reason = new Error("stop");
  ctl.abort(reason);
  assert.equal(await rejectsWith(pending), reason);
});
